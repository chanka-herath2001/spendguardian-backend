const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const upload = require('../middleware/upload');
const { verifyToken } = require('../middleware/auth');
const { parseFile } = require('../services/sheetParser');
const { suggestCharts } = require('../services/chartSuggester');
const { db, storage, admin } = require('../firebase');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function assertProjectOwner(projectId, uid) {
  const projectRef = db.collection('projects').doc(projectId);
  const projectDoc = await projectRef.get();

  if (!projectDoc.exists) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  if (projectDoc.data().ownerId !== uid) {
    const err = new Error('Access denied: you do not own this project');
    err.status = 403;
    throw err;
  }

  return projectDoc.data();
}

async function assertUserExists(uid) {
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) {
    const err = new Error('User profile not found. Please call POST /api/users/me first.');
    err.status = 404;
    throw err;
  }
  return userDoc.data();
}

// ─── Health Check ─────────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ═════════════════════════════════════════════════════════════════════════════
// USER ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════

router.post('/users/me', verifyToken, express.json(), async (req, res) => {
  try {
    const uid = req.user.uid;
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      return res.json({ success: true, user: userDoc.data(), created: false });
    }

    const { currency = 'USD', dateFormat = 'DD/MM/YYYY' } = req.body;

    const userData = {
      uid,
      email: req.user.email || '',
      displayName: req.user.name || req.user.email?.split('@')[0] || 'User',
      photoURL: req.user.picture || null,
      currency,
      dateFormat,
      createdAt: new Date().toISOString(),
      lastActiveProject: null,
    };

    await userRef.set(userData);
    res.status(201).json({ success: true, user: userData, created: true });
  } catch (err) {
    console.error('Create user error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/users/me', verifyToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User profile not found. Call POST /api/users/me to create it.' });
    }

    res.json({ success: true, user: userDoc.data() });
  } catch (err) {
    console.error('Get user error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/users/me', verifyToken, express.json(), async (req, res) => {
  try {
    await assertUserExists(req.user.uid);

    const allowed = ['displayName', 'currency', 'dateFormat', 'lastActiveProject'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: `No valid fields to update. Allowed: ${allowed.join(', ')}` });
    }

    updates.updatedAt = new Date().toISOString();
    await db.collection('users').doc(req.user.uid).update(updates);

    const updatedDoc = await db.collection('users').doc(req.user.uid).get();
    res.json({ success: true, user: updatedDoc.data() });
  } catch (err) {
    console.error('Update user error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/users/me', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    await assertUserExists(uid);

    const projectsSnapshot = await db.collection('projects')
      .where('ownerId', '==', uid)
      .get();

    for (const projectDoc of projectsSnapshot.docs) {
      const projectId = projectDoc.id;
      const sheetsSnapshot = await db.collection('projects').doc(projectId).collection('sheets').get();
      for (const sheetDoc of sheetsSnapshot.docs) {
        const basePath = `projects/${projectId}/sheets/${sheetDoc.id}`;
        const [files] = await storage.getFiles({ prefix: basePath });
        await Promise.all(files.map((f) => f.delete()));
        await sheetDoc.ref.delete();
      }
      await projectDoc.ref.delete();
    }

    await db.collection('users').doc(uid).delete();
    await admin.auth().deleteUser(uid);

    res.json({ success: true, message: 'Account and all data deleted successfully' });
  } catch (err) {
    console.error('Delete user error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// PROJECT ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════

router.post('/projects', verifyToken, express.json(), async (req, res) => {
  try {
    const userData = await assertUserExists(req.user.uid);

    const { name, description = '' } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const currency = req.body.currency || userData.currency || 'USD';

    const existing = await db.collection('projects')
      .where('ownerId', '==', req.user.uid)
      .get();

    if (existing.size >= 5) {
      return res.status(403).json({ error: 'Free tier limit: maximum 5 projects allowed' });
    }

    const projectId = crypto.randomUUID();
    const projectData = {
      id: projectId,
      ownerId: req.user.uid,
      ownerEmail: req.user.email || '',
      name: name.trim(),
      description: description.trim(),
      currency,
      sheetCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dashboardLayout: [],
    };

    await db.collection('projects').doc(projectId).set(projectData);

    await db.collection('users').doc(req.user.uid).update({
      lastActiveProject: projectId,
      updatedAt: new Date().toISOString(),
    });

    res.status(201).json({ success: true, project: projectData });
  } catch (err) {
    console.error('Create project error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/projects', verifyToken, async (req, res) => {
  try {
    await assertUserExists(req.user.uid);

    const snapshot = await db.collection('projects')
      .where('ownerId', '==', req.user.uid)
      .get();

    // Sort in JS — no composite index needed
    const projects = snapshot.docs
      .map(doc => doc.data())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, projects });
  } catch (err) {
    console.error('List projects error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/projects/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    await assertUserExists(req.user.uid);
    await assertProjectOwner(id, req.user.uid);

    const projectRef = db.collection('projects').doc(id);
    const sheetsSnapshot = await projectRef.collection('sheets').get();

    for (const sheetDoc of sheetsSnapshot.docs) {
      const basePath = `projects/${id}/sheets/${sheetDoc.id}`;
      const [files] = await storage.getFiles({ prefix: basePath });
      await Promise.all(files.map((f) => f.delete()));
      await sheetDoc.ref.delete();
    }

    await projectRef.delete();

    const userDoc = await db.collection('users').doc(req.user.uid).get();
    if (userDoc.data().lastActiveProject === id) {
      await db.collection('users').doc(req.user.uid).update({
        lastActiveProject: null,
        updatedAt: new Date().toISOString(),
      });
    }

    res.json({ success: true, message: 'Project deleted successfully' });
  } catch (err) {
    console.error('Delete project error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// SHEET ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════

router.post('/parse', verifyToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { projectId, selectedSheet } = req.body;
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    await assertUserExists(req.user.uid);
    await assertProjectOwner(projectId, req.user.uid);

    const result = parseFile(req.file.buffer, req.file.originalname, selectedSheet || null);
    const { rows, ...meta } = result;

    res.json({
      success: true,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      ...meta,
    });
  } catch (err) {
    console.error('Parse error:', err.message);
    res.status(err.status || 422).json({ error: err.message });
  }
});

router.post('/ingest', verifyToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { projectId, selectedSheet, columnOverrides } = req.body;
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    await assertUserExists(req.user.uid);
    await assertProjectOwner(projectId, req.user.uid);

    const parsed = parseFile(req.file.buffer, req.file.originalname, selectedSheet || null);

    let columns = parsed.columns;
    if (columnOverrides) {
      const overrides = typeof columnOverrides === 'string'
        ? JSON.parse(columnOverrides)
        : columnOverrides;
      columns = columns.map((col) => ({
        ...col,
        type: overrides[col.name] || col.type,
      }));
    }

    const sheetId = crypto.randomUUID();
    const storagePath = `projects/${projectId}/sheets/${sheetId}/raw_${req.file.originalname}`;
    const rawFile = storage.file(storagePath);
    await rawFile.save(req.file.buffer, { metadata: { contentType: req.file.mimetype } });
    const [storageUrl] = await rawFile.getSignedUrl({ action: 'read', expires: '2099-01-01' });

    const jsonPath = `projects/${projectId}/sheets/${sheetId}/data.json`;
    const jsonFile = storage.file(jsonPath);
    await jsonFile.save(JSON.stringify(parsed.rows), { metadata: { contentType: 'application/json' } });
    const [parsedDataUrl] = await jsonFile.getSignedUrl({ action: 'read', expires: '2099-01-01' });

    const sheetData = {
      id: sheetId,
      projectId,
      ownerId: req.user.uid,
      ownerEmail: req.user.email || '',
      fileName: req.file.originalname,
      selectedSheet: parsed.selectedSheet,
      uploadedAt: new Date().toISOString(),
      rowCount: parsed.rowCount,
      columns,
      storageUrl,
      parsedDataUrl,
    };

    await db.collection('projects').doc(projectId).collection('sheets').doc(sheetId).set(sheetData);

    await db.collection('projects').doc(projectId).set({
      sheetCount: admin.firestore.FieldValue.increment(1),
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    await db.collection('users').doc(req.user.uid).update({
      lastActiveProject: projectId,
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, sheetId, rowCount: parsed.rowCount, columns, preview: parsed.preview });
  } catch (err) {
    console.error('Ingest error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/suggest-charts', verifyToken, express.json(), async (req, res) => {
  try {
    const { columns } = req.body;
    if (!columns || !Array.isArray(columns)) {
      return res.status(400).json({ error: 'columns array is required' });
    }
    const suggestions = suggestCharts(columns);
    res.json({ success: true, ...suggestions });
  } catch (err) {
    console.error('Suggest charts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:projectId/sheets', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;

    await assertUserExists(req.user.uid);
    await assertProjectOwner(projectId, req.user.uid);

    const sheetsSnapshot = await db
      .collection('projects').doc(projectId)
      .collection('sheets')
      .get();

    // Sort in JS — no composite index needed
    const sheets = sheetsSnapshot.docs
      .map(doc => {
        const { parsedDataUrl, storageUrl, ...safe } = doc.data();
        return safe;
      })
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.json({ success: true, sheets });
  } catch (err) {
    console.error('List sheets error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/sheet/:id/data', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId query param is required' });

    await assertUserExists(req.user.uid);
    await assertProjectOwner(projectId, req.user.uid);

    const sheetDoc = await db.collection('projects').doc(projectId).collection('sheets').doc(id).get();
    if (!sheetDoc.exists) return res.status(404).json({ error: 'Sheet not found' });

    const sheetData = sheetDoc.data();
    if (sheetData.ownerId !== req.user.uid) return res.status(403).json({ error: 'Access denied' });

    const https = require('https');
    const jsonData = await new Promise((resolve, reject) => {
      https.get(sheetData.parsedDataUrl, (response) => {
        let data = '';
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () => resolve(JSON.parse(data)));
        response.on('error', reject);
      }).on('error', reject);
    });

    res.json({ success: true, sheetId: id, rowCount: sheetData.rowCount, columns: sheetData.columns, rows: jsonData });
  } catch (err) {
    console.error('Get sheet data error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── PUT /api/sheet/:id/data ──────────────────────────────────────────────────
// Save edited rows + updated column definitions back to Firebase Storage.
// Also re-runs column type inference on the new columns list.

router.put('/sheet/:id/data', verifyToken, express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { projectId, rows, columns } = req.body;

    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows must be an array' });
    if (!Array.isArray(columns)) return res.status(400).json({ error: 'columns must be an array' });

    await assertUserExists(req.user.uid);
    await assertProjectOwner(projectId, req.user.uid);

    const sheetRef = db.collection('projects').doc(projectId).collection('sheets').doc(id);
    const sheetDoc = await sheetRef.get();
    if (!sheetDoc.exists) return res.status(404).json({ error: 'Sheet not found' });

    const sheetData = sheetDoc.data();
    if (sheetData.ownerId !== req.user.uid) return res.status(403).json({ error: 'Access denied' });

    // Overwrite the parsed JSON in Firebase Storage
    const jsonFile = storage.file(`projects/${projectId}/sheets/${id}/data.json`);
    await jsonFile.save(JSON.stringify(rows), { metadata: { contentType: 'application/json' } });

    // Update sheet metadata — new rowCount + columns
    await sheetRef.update({
      rowCount: rows.length,
      columns,
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, rowCount: rows.length, columns });
  } catch (err) {
    console.error('Save sheet data error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/sheet/:id', verifyToken, express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ error: 'projectId is required in body' });

    await assertUserExists(req.user.uid);
    await assertProjectOwner(projectId, req.user.uid);

    const sheetRef = db.collection('projects').doc(projectId).collection('sheets').doc(id);
    const sheetDoc = await sheetRef.get();
    if (!sheetDoc.exists) return res.status(404).json({ error: 'Sheet not found' });
    if (sheetDoc.data().ownerId !== req.user.uid) return res.status(403).json({ error: 'Access denied' });

    const basePath = `projects/${projectId}/sheets/${id}`;
    const [files] = await storage.getFiles({ prefix: basePath });
    await Promise.all(files.map((f) => f.delete()));
    await sheetRef.delete();

    await db.collection('projects').doc(projectId).set({
      sheetCount: admin.firestore.FieldValue.increment(-1),
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    res.json({ success: true, message: 'Sheet deleted successfully' });
  } catch (err) {
    console.error('Delete sheet error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;