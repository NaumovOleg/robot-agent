// Custom Jest resolver for @langchain/core subpath imports.
// @langchain/core ships some paths as flat .cjs files (e.g. outputs.cjs) and
// others as directories with an index.cjs (e.g. messages/index.cjs). This
// resolver tries the flat file first and falls back to the directory index.
const path = require('path');
const fs = require('fs');

module.exports = (request, options) => {
  // Only intercept @langchain/core sub-path imports
  const coreSubMatch = request.match(/^@langchain\/core\/(.+)$/);
  if (coreSubMatch) {
    const subPath = coreSubMatch[1];
    const base = path.join(
      options.rootDir,
      'packages/agent/node_modules/@langchain/core/dist',
    );

    // Try flat .cjs file first
    const flatFile = path.join(base, `${subPath}.cjs`);
    if (fs.existsSync(flatFile)) return flatFile;

    // Try directory index.cjs
    const dirIndex = path.join(base, subPath, 'index.cjs');
    if (fs.existsSync(dirIndex)) return dirIndex;
  }

  // Fall back to default resolver
  return options.defaultResolver(request, options);
};
