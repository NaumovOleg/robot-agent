import type { Node } from 'web-tree-sitter';
import { AST_LANGUAGE_DECLARATIONS } from '../../../../shared/src/ast/languages';

interface ImportRecord {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  location: string;
}

const text = (node: Node | null | undefined, source: string): string =>
  node ? source.slice(node.startIndex, node.endIndex) : '';

const stripQuotes = (value: string): string => value.replace(/^['"`]/, '').replace(/['"`]$/, '');

const location = (node: Node): string => `${node.startPosition.row + 1}:${node.startPosition.column + 1}`;

const unique = (values: string[]): string[] => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const leaf = (value: string): string => {
  const cleaned = value.trim().replace(/\\+$/g, '');
  const parts = cleaned.split(/::|\/|\\|\./).filter(Boolean);
  return parts[parts.length - 1] ?? cleaned;
};

const hasImportAncestor = (node: Node, importKinds: Set<string>): boolean => {
  let parent = node.parent;
  while (parent) {
    if (importKinds.has(parent.type)) return true;
    parent = parent.parent;
  }
  return false;
};

const isRubyImportCall = (node: Node, source: string): boolean => {
  if (node.type !== 'call') return false;
  const callee = node.namedChildren[0];
  if (!callee || callee.type !== 'identifier') return false;
  const name = text(callee, source);
  return name === 'require' || name === 'require_relative';
};

const collectTsImport = (node: Node, source: string): ImportRecord[] => {
  const importClause = node.namedChildren.find((child) => child.type === 'import_clause');
  const sourceNode = node.childForFieldName('source') || node.childForFieldName('module');
  const sourcePath = stripQuotes(text(sourceNode, source));

  const specifiers: string[] = [];
  let hasDefault = false;
  let hasNonDefault = false;

  if (importClause) {
    for (const child of importClause.namedChildren) {
      if (child.type === 'identifier') {
        specifiers.push(text(child, source));
        hasDefault = true;
        continue;
      }

      if (child.type === 'namespace_import') {
        specifiers.push(text(child, source));
        hasNonDefault = true;
        continue;
      }

      if (child.type === 'named_imports') {
        hasNonDefault = true;
        for (const named of child.namedChildren) {
          if (named.type === 'import_specifier') {
            specifiers.push(text(named, source));
          }
        }
      }
    }
  }

  return [
    {
      source: sourcePath,
      specifiers: unique(specifiers),
      isDefault: hasDefault && !hasNonDefault,
      location: location(node),
    },
  ];
};

const collectPythonImports = (node: Node, source: string): ImportRecord[] => {
  if (node.type === 'import_statement') {
    const specifiers = unique(node.namedChildren.map((child) => text(child, source)));
    const sourcePath = specifiers[0] ?? '';
    return [
      {
        source: sourcePath,
        specifiers,
        isDefault: false,
        location: location(node),
      },
    ];
  }

  if (node.type === 'import_from_statement') {
    const sourceNode = node.namedChildren[0];
    const sourcePath = stripQuotes(text(sourceNode, source));
    const specifiers = unique(node.namedChildren.slice(1).map((child) => text(child, source)));

    return [
      {
        source: sourcePath,
        specifiers,
        isDefault: false,
        location: location(node),
      },
    ];
  }

  return [];
};

const collectGoImports = (node: Node, source: string): ImportRecord[] => {
  const specNodes =
    node.type === 'import_declaration'
      ? node.namedChildren.flatMap((child) =>
          child.type === 'import_spec_list'
            ? child.namedChildren.filter((grandchild) => grandchild.type === 'import_spec')
            : []
        )
      : node.type === 'import_spec'
        ? [node]
        : [];

  return specNodes.map((specNode) => {
    const specChildren = specNode.namedChildren;
    const sourceNode = specChildren.find((child) => child.type.includes('string'));
    const sourcePath = stripQuotes(text(sourceNode, source));
    const aliasNode = specChildren.find((child) => child !== sourceNode);
    const specifier = aliasNode ? text(aliasNode, source).trim() : leaf(sourcePath);

    return {
      source: sourcePath,
      specifiers: unique([specifier || sourcePath]),
      isDefault: false,
      location: location(specNode),
    };
  });
};

const collectRustImports = (node: Node, source: string): ImportRecord[] => {
  const body = text(node, source)
    .replace(/^(?:pub\s+)?use\s+/, '')
    .replace(/^(?:pub\s+)?extern\s+crate\s+/, '')
    .replace(/;$/, '')
    .trim();

  if (!body) {
    return [];
  }

  if (node.type === 'extern_crate_declaration') {
    const specifier = leaf(body);
    return [
      {
        source: body,
        specifiers: unique([specifier]),
        isDefault: false,
        location: location(node),
      },
    ];
  }

  if (body.includes('{') && body.includes('}')) {
    const prefix = body.slice(0, body.indexOf('{')).replace(/::$/, '').replace(/\\$/, '').trim();
    const inner = body.slice(body.indexOf('{') + 1, body.lastIndexOf('}'));
    const specifiers = unique(
      inner
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const alias = entry.match(/\s+as\s+(.+)$/);
          return alias ? alias[1].trim() : leaf(entry);
        })
    );

    return [
      {
        source: prefix,
        specifiers,
        isDefault: false,
        location: location(node),
      },
    ];
  }

  if (body.includes(' as ')) {
    const [sourcePath, alias] = body.split(/\s+as\s+/);
    return [
      {
        source: sourcePath.trim(),
        specifiers: unique([alias.trim()]),
        isDefault: false,
        location: location(node),
      },
    ];
  }

  const sourcePath = body;
  return [
    {
      source: sourcePath,
      specifiers: unique([leaf(sourcePath)]),
      isDefault: false,
      location: location(node),
    },
  ];
};

const collectJavaImports = (node: Node, source: string): ImportRecord[] => {
  const body = text(node, source)
    .replace(/^import\s+/, '')
    .replace(/;$/, '')
    .trim();

  if (!body) return [];

  const normalized = body.startsWith('static ') ? body.slice('static '.length).trim() : body;
  const sourcePath = normalized.endsWith('.*') ? normalized.slice(0, -2).trim() : normalized;
  const specifier = normalized.endsWith('.*') ? '*' : leaf(sourcePath);

  return [
    {
      source: sourcePath,
      specifiers: unique([specifier]),
      isDefault: false,
      location: location(node),
    },
  ];
};

const collectRubyImports = (node: Node, source: string): ImportRecord[] => {
  const body = text(node, source).trim();
  const match = body.match(/^require(?:_relative)?\s+["'](.+)["']$/);
  if (!match) return [];

  const sourcePath = match[1];
  return [
    {
      source: sourcePath,
      specifiers: unique([leaf(sourcePath)]),
      isDefault: false,
      location: location(node),
    },
  ];
};

const collectPhpImports = (node: Node, source: string): ImportRecord[] => {
  const body = text(node, source)
    .replace(/^use\s+/, '')
    .replace(/;$/, '')
    .trim();

  if (!body) return [];

  const withoutPrefix = body.replace(/^(?:function|const)\s+/, '').trim();

  if (withoutPrefix.includes('{') && withoutPrefix.includes('}')) {
    const prefix = withoutPrefix
      .slice(0, withoutPrefix.indexOf('{'))
      .replace(/\\$/, '')
      .trim();
    const inner = withoutPrefix.slice(withoutPrefix.indexOf('{') + 1, withoutPrefix.lastIndexOf('}'));
    const specifiers = unique(
      inner
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const alias = entry.match(/\s+as\s+(.+)$/i);
          if (alias) return alias[1].trim();
          return leaf(entry);
        })
    );

    return [
      {
        source: prefix,
        specifiers,
        isDefault: false,
        location: location(node),
      },
    ];
  }

  if (withoutPrefix.includes(' as ')) {
    const [sourcePath, alias] = withoutPrefix.split(/\s+as\s+/i);
    return [
      {
        source: sourcePath.trim(),
        specifiers: unique([alias.trim()]),
        isDefault: false,
        location: location(node),
      },
    ];
  }

  return [
    {
      source: withoutPrefix,
      specifiers: unique([leaf(withoutPrefix)]),
      isDefault: false,
      location: location(node),
    },
  ];
};

const collectGenericImports = (node: Node, source: string): ImportRecord[] => [
  {
    source: stripQuotes(text(node.namedChildren[0], source)),
    specifiers: unique(node.namedChildren.slice(1).map((child) => text(child, source))),
    isDefault: false,
    location: location(node),
  },
];

const scanPhpImports = (source: string): ImportRecord[] =>
  source.split('\n').flatMap((line, index) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('use ')) return [];

    const body = trimmed.replace(/^use\s+/, '').replace(/;$/, '').trim();
    if (!body) return [];

    const withoutPrefix = body.replace(/^(?:function|const)\s+/, '').trim();
    const lineLocation = `${index + 1}:1`;

    if (withoutPrefix.includes('{') && withoutPrefix.includes('}')) {
      const prefix = withoutPrefix.slice(0, withoutPrefix.indexOf('{')).replace(/\\$/, '').trim();
      const inner = withoutPrefix.slice(
        withoutPrefix.indexOf('{') + 1,
        withoutPrefix.lastIndexOf('}')
      );
      const specifiers = unique(
        inner
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map((entry) => {
            const alias = entry.match(/\s+as\s+(.+)$/i);
            return alias ? alias[1].trim() : leaf(entry);
          })
      );

      return [
        {
          source: prefix,
          specifiers,
          isDefault: false,
          location: lineLocation,
        },
      ];
    }

    if (withoutPrefix.includes(' as ')) {
      const [sourcePath, alias] = withoutPrefix.split(/\s+as\s+/i);
      return [
        {
          source: sourcePath.trim(),
          specifiers: unique([alias.trim()]),
          isDefault: false,
          location: lineLocation,
        },
      ];
    }

    return [
      {
        source: withoutPrefix,
        specifiers: unique([leaf(withoutPrefix)]),
        isDefault: false,
        location: lineLocation,
      },
    ];
  });

function collectImports(node: Node, source: string, language: string): ImportRecord[] {
  switch (language) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
    case 'jsx':
      if (node.type === 'import_statement' || node.type === 'import_declaration') {
        return collectTsImport(node, source);
      }
      break;
    case 'python':
      if (node.type === 'import_statement' || node.type === 'import_from_statement') {
        return collectPythonImports(node, source);
      }
      break;
    case 'go':
      if (node.type === 'import_declaration' || node.type === 'import_spec') {
        return collectGoImports(node, source);
      }
      break;
    case 'rust':
      if (node.type === 'use_declaration' || node.type === 'extern_crate_declaration') {
        return collectRustImports(node, source);
      }
      break;
    case 'java':
      if (node.type === 'import_declaration') {
        return collectJavaImports(node, source);
      }
      break;
    case 'ruby':
      if (node.type === 'require' || node.type === 'require_relative' || node.type === 'call') {
        return collectRubyImports(node, source);
      }
      break;
    case 'php':
      if (node.type === 'namespace_use_declaration' || node.type === 'namespace_use_clause') {
        return collectPhpImports(node, source);
      }
      break;
    default:
      break;
  }

  if (!node.namedChildren.length) return [];
  return collectGenericImports(node, source);
}

export function findImports(rootNode: Node, source: string, language: string) {
  if (language === 'php') {
    const phpImports = scanPhpImports(source);
    if (phpImports.length > 0) return phpImports;
  }

  const config = AST_LANGUAGE_DECLARATIONS[language];
  if (!config?.importKinds?.size) return [];

  const imports: ImportRecord[] = [];

  const traverse = (node: Node) => {
    const isCandidate =
      (config.importKinds.has(node.type) && !hasImportAncestor(node, config.importKinds)) ||
      (language === 'ruby' && isRubyImportCall(node, source) && !hasImportAncestor(node, config.importKinds));

    if (isCandidate) {
      imports.push(...collectImports(node, source, language));
      return;
    }

    for (const child of node.namedChildren) {
      traverse(child);
    }
  };

  traverse(rootNode);

  return imports.filter(
    (record, index, array) =>
      array.findIndex(
        (candidate) =>
          candidate.source === record.source &&
          candidate.location === record.location &&
          candidate.isDefault === record.isDefault &&
          candidate.specifiers.join('\u0000') === record.specifiers.join('\u0000')
      ) === index
  );
}
