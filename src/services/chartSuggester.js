/**
 * Given an array of column metadata objects ({ name, type }),
 * return an array of chart config recommendations.
 */
function suggestCharts(columns) {
  const suggestions = [];

  const dateCols = columns.filter((c) => c.type === 'Date');
  const numericCols = columns.filter((c) => ['Number', 'Currency', 'Percentage'].includes(c.type));
  const categoryCols = columns.filter((c) => c.type === 'Category');

  // --- Line / Area charts: Date + Numeric ---
  for (const dateCol of dateCols) {
    for (const numCol of numericCols) {
      suggestions.push({
        id: `line_${dateCol.name}_${numCol.name}`.replace(/\s+/g, '_'),
        chartType: 'line',
        title: `${numCol.name} Over Time`,
        xColumn: dateCol.name,
        yColumn: numCol.name,
        description: `Trend of ${numCol.name} by ${dateCol.name}`,
      });

      suggestions.push({
        id: `area_${dateCol.name}_${numCol.name}`.replace(/\s+/g, '_'),
        chartType: 'area',
        title: `${numCol.name} Area Trend`,
        xColumn: dateCol.name,
        yColumn: numCol.name,
        description: `Area chart of ${numCol.name} over ${dateCol.name}`,
      });
    }
  }

  // --- Bar charts: Category + Numeric ---
  for (const catCol of categoryCols) {
    for (const numCol of numericCols) {
      suggestions.push({
        id: `bar_${catCol.name}_${numCol.name}`.replace(/\s+/g, '_'),
        chartType: 'bar',
        title: `${numCol.name} by ${catCol.name}`,
        xColumn: catCol.name,
        yColumn: numCol.name,
        description: `Compare ${numCol.name} across ${catCol.name} categories`,
      });
    }
  }

  // --- Pie / Donut charts: Category (low cardinality) + Numeric ---
  // We flag this with a pieSuitable flag; the frontend knows sample.length <= 10
  for (const catCol of categoryCols) {
    for (const numCol of numericCols) {
      suggestions.push({
        id: `pie_${catCol.name}_${numCol.name}`.replace(/\s+/g, '_'),
        chartType: 'pie',
        title: `${numCol.name} Distribution by ${catCol.name}`,
        xColumn: catCol.name,
        yColumn: numCol.name,
        description: `Proportion of ${numCol.name} per ${catCol.name}`,
      });
    }
  }

  // --- Summary stat cards: one per numeric column ---
  const statCards = numericCols.map((col) => ({
    id: `stats_${col.name}`.replace(/\s+/g, '_'),
    chartType: 'stats',
    title: `${col.name} Summary`,
    yColumn: col.name,
    description: `Total, Average, Min, Max for ${col.name}`,
  }));

  return {
    charts: suggestions,
    statCards,
  };
}

module.exports = { suggestCharts };
