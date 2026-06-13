import type { Node } from 'web-tree-sitter';
import { findNodesByTypes } from './findNodes';
import { AST_LANGUAGE_DECLARATIONS } from '../../../../shared/src/ast/languages';

interface ClassRecord {
  name: string;
  methods: string[];
  properties: string[];
  startLine: number;
  endLine: number;
  location: string;
}

const text = (node: Node | null | undefined, source: string): string =>
  node ? source.slice(node.startIndex, node.endIndex) : '';

const location = (node: Node): string => `${node.startPosition.row + 1}:${node.startPosition.column + 1}`;

const unique = (values: string[]): string[] => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const IDENTIFIER_NODE_TYPES = new Set([
  'identifier',
  'property_identifier',
  'type_identifier',
  'field_identifier',
  'variable_name',
  'enum_variant',
]);

const findFirstFieldNode = (node: Node, fieldNames: string[]): Node | null => {
  for (const fieldName of fieldNames) {
    const direct = node.childForFieldName(fieldName);
    if (direct) return direct;
  }

  for (const child of node.namedChildren) {
    const nested = findFirstFieldNode(child, fieldNames);
    if (nested) return nested;
  }

  return null;
};

const resolveName = (node: Node, source: string, fieldNames: string[] = ['name']): string => {
  const field = findFirstFieldNode(node, fieldNames);
  if (field) return text(field, source);

  const stack = [...node.namedChildren];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) continue;
    if (IDENTIFIER_NODE_TYPES.has(current.type)) {
      return text(current, source);
    }
    stack.unshift(...current.namedChildren);
  }

  return '';
};

const collectNames = (
  bodyNode: Node | null | undefined,
  source: string,
  nodeTypes: Set<string>,
  fieldNames: string[] = ['name']
): string[] => {
  if (!bodyNode) return [];
  const nodes = findNodesByTypes(bodyNode, nodeTypes);
  return unique(nodes.map((node) => resolveName(node, source, fieldNames)));
};

const collectGenericClass = (node: Node, source: string, config: { functionKinds: Set<string> }): ClassRecord => {
  const bodyNode = node.childForFieldName('body');
  const methods = unique(collectNames(bodyNode, source, config.functionKinds));
  const propertyKinds = new Set([
    'property_definition',
    'public_field_definition',
    'private_field_definition',
    'field_declaration',
    'field_definition',
  ]);
  const properties = unique(collectNames(bodyNode, source, propertyKinds, ['name', 'declarator']));

  return {
    name: resolveName(node, source, ['name']),
    methods,
    properties,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    location: location(node),
  };
};

const collectGoClasses = (node: Node, source: string): ClassRecord[] => {
  if (node.type !== 'type_declaration') return [];

  const typeSpecs = findNodesByTypes(node, new Set(['type_spec']));
  const classes: ClassRecord[] = [];

  for (const typeSpec of typeSpecs) {
    const typeNode = typeSpec.childForFieldName('type');
    const bodyNode =
      typeNode?.type === 'struct_type' || typeNode?.type === 'interface_type' ? typeNode : null;

    const properties =
      bodyNode?.type === 'struct_type'
        ? unique(collectNames(bodyNode, source, new Set(['field_declaration']), ['name', 'declarator']))
        : [];
    const methods =
      bodyNode?.type === 'interface_type'
        ? unique(collectNames(bodyNode, source, new Set(['method_spec']), ['name']))
        : [];

    classes.push({
      name: resolveName(typeSpec, source, ['name']) || resolveName(node, source, ['name']),
      methods,
      properties,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      location: location(node),
    });
  }

  return classes;
};

const getRustBodyNode = (node: Node): Node | null =>
  node.childForFieldName('body') ?? node.namedChildren.find((child) => child.type === 'declaration_list') ?? null;

const collectRustClasses = (node: Node, source: string): ClassRecord[] => {
  const name = resolveName(node, source, node.type === 'impl_item' ? ['type', 'name'] : ['name', 'type']);
  const bodyNode = getRustBodyNode(node);

  let methods: string[] = [];
  let properties: string[] = [];

  switch (node.type) {
    case 'impl_item':
      methods = unique(
        collectNames(bodyNode, source, new Set(['function_item', 'method_declaration']), ['name'])
      );
      break;
    case 'trait_item':
      methods = unique(
        collectNames(
          bodyNode,
          source,
          new Set(['function_signature_item', 'function_item', 'method_signature']),
          ['name']
        )
      );
      break;
    case 'struct_item':
    case 'union_item':
      properties = unique(
        collectNames(bodyNode, source, new Set(['field_declaration']), ['name', 'declarator'])
      );
      break;
    case 'enum_item':
      properties = unique(collectNames(bodyNode, source, new Set(['enum_variant']), ['name']));
      break;
  }

  return [
    {
      name,
      methods,
      properties,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      location: location(node),
    },
  ];
};

const collectPhpClassProperties = (bodyNode: Node | null | undefined, source: string): string[] =>
  unique(collectNames(bodyNode, source, new Set(['property_declaration', 'field_declaration']), ['name', 'declarator']));

export function findClasses(node: Node, source: string, language: string) {
  const config = AST_LANGUAGE_DECLARATIONS[language];
  if (!config || config.classKinds.size === 0) return [];

  const classes: ClassRecord[] = [];
  const shouldCollect = (current: Node): boolean => {
    if (language === 'go') {
      return current.type === 'type_declaration';
    }

    if (language === 'rust') {
      return config.classKinds.has(current.type) || current.type === 'trait_item';
    }

    return config.classKinds.has(current.type);
  };

  const traverse = (current: Node) => {
    if (shouldCollect(current)) {
      if (language === 'go') {
        classes.push(...collectGoClasses(current, source));
      } else if (language === 'rust') {
        classes.push(...collectRustClasses(current, source));
      } else {
        const record = collectGenericClass(current, source, config);
        if (language === 'php') {
          const bodyNode = current.childForFieldName('body');
          record.properties = collectPhpClassProperties(bodyNode, source);
        }
        classes.push(record);
      }
    }

    for (const child of current.namedChildren) {
      traverse(child);
    }
  };

  traverse(node);
  return classes;
}
