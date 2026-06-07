import { astAnalyzerTool } from '../../packages/tools/src/tools/reader/astAnalyzer';

const fixturePath = '/Users/oleg/Documents/projects/robocode-cli/__tests__/ast/file.tsx';

describe('astAnalyzerTool - universal fixture', () => {
  it('should extract meaningful functions', async () => {
    const res = JSON.parse(
      await astAnalyzerTool.invoke({
        filePath: fixturePath,
        queryType: 'functions',
        includeBody: true,
      })
    );

    const names = res.functions.map((f: any) => f.name);
    expect(names).toEqual(expect.arrayContaining(['Screen', 'App']));
    expect(res.functions.length).toBeGreaterThan(0);
    for (const fn of res.functions) {
      expect(fn).toHaveProperty('params');
      expect(fn).toHaveProperty('bodyPreview');
    }
    const arrowFns = res.functions.filter((f: any) => f.signature?.includes('=>'));
    expect(arrowFns.length).toBeGreaterThan(0);
  });

  it('classes extraction is stable', async () => {
    const res = JSON.parse(
      await astAnalyzerTool.invoke({
        filePath: fixturePath,
        queryType: 'classes',
      })
    );

    const logger = res.classes.find((c: any) => c.name === 'Logger');

    expect(logger).toBeDefined();
    expect(logger.methods).toEqual(expect.arrayContaining(['add', 'getAll']));
  });

  it('imports extraction is stable', async () => {
    const res = JSON.parse(
      await astAnalyzerTool.invoke({
        filePath: fixturePath,
        queryType: 'imports',
      })
    );

    const sources = res.imports.map((i: any) => i.source);

    expect(sources).toEqual(expect.arrayContaining(['react']));
  });
});
