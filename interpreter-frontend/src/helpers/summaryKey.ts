// Helper to generate a unique key for the summary area
// This will force a re-render when the key changes
let summaryKey = 0;

export const getSummaryKey = (): string => {
  return `summary-${summaryKey++}`;
};

export default {
  getSummaryKey
}; 