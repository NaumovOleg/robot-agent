import type { Node } from 'web-tree-sitter';
import { AST_LANGUAGE_DECLARATIONS } from '../../../../shared/src/ast/languages';

const text = (node: Node | null | undefined, source: string): string =>
  node ? source.slice(node.startIndex, node.endIndex) : '';

export function findNodesByTypes(rootNode: Node, types: Set<string>): Node[] {
  const result: Node[] = [];

  const traverse = (node: Node) => {
    if (types.has(node.type)) {
      result.push(node);
    }
    for (const child of node.namedChildren) {
      traverse(child);
    }
  };
  traverse(rootNode);
  return result;
}

function getRealFunctionName(node: Node, source: string): string {
  const direct = node.childForFieldName('name');

  if (direct) return text(direct, source);
  let parent = node.parent;

  while (parent) {
    if (parent.type === 'variable_declarator') {
      const id = parent.childForFieldName('name') || parent.childForFieldName('id');

      if (id) return text(id, source);
    }

    if (parent.type === 'function_declaration') {
      const id = parent.childForFieldName('name');

      if (id) return text(id, source);
    }

    if (parent.type === 'assignment_expression') {
      const left = parent.childForFieldName('left');
      if (left) return text(left, source);
    }

    if (parent.type === 'export_default_declaration') {
      return 'default';
    }

    if (parent.type === 'export_named_declaration') {
      const decl = parent.childForFieldName('declaration');

      if (decl?.type === 'function_declaration') {
        const id = decl.childForFieldName('name');

        if (id) return text(id, source);
      }
    }

    parent = parent.parent;
  }

  return 'anonymous';
}

interface ParamDetail {
  name: string;
  type?: string;
  defaultValue?: string;
  isRest?: boolean;
  pattern?: 'object' | 'array' | 'identifier';
  children?: ParamDetail[];
}
function getParamDetails(paramsNode: Node | null, source: string): ParamDetail[] {
  if (!paramsNode) return [];

  const result: ParamDetail[] = [];

  const parse = (node: Node, parentPath = ''): ParamDetail => {
    switch (node.type) {
      case 'identifier':
        return {
          name: parentPath || text(node, source),
          pattern: 'identifier',
        };

      case 'object_pattern': {
        const children: ParamDetail[] = [];
        for (const child of node.namedChildren) {
          if (child.type === 'shorthand_property_identifier_pattern') {
            const name = text(child, source);
            children.push({ name, pattern: 'identifier' });
          } else if (child.type === 'pair') {
            const keyNode = child.childForFieldName('key');
            const valueNode = child.childForFieldName('value');
            const keyName = keyNode ? text(keyNode, source) : '';
            if (valueNode) {
              children.push(parse(valueNode, keyName));
            } else {
              children.push({ name: keyName, pattern: 'identifier' });
            }
          } else if (child.type === 'rest_pattern') {
            const arg = child.childForFieldName('argument');
            if (arg) {
              const rest = parse(arg, parentPath);
              rest.isRest = true;
              children.push(rest);
            }
          }
        }
        return {
          name: '',
          pattern: 'object',
          children,
        };
      }

      case 'array_pattern': {
        const children: ParamDetail[] = [];
        for (let i = 0; i < node.namedChildren.length; i++) {
          const elem = node.namedChildren[i];
          children.push(parse(elem, `[${i}]`));
        }
        return {
          name: '',
          pattern: 'array',
          children,
        };
      }

      case 'assignment_pattern': {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (left) {
          const detail = parse(left, parentPath);
          detail.defaultValue = right ? text(right, source) : undefined;
          return detail;
        }
        return { name: text(node, source), pattern: 'identifier' };
      }

      case 'rest_pattern': {
        const arg = node.childForFieldName('argument');
        if (arg) {
          const detail = parse(arg, parentPath);
          detail.isRest = true;
          return detail;
        }
        return { name: text(node, source), pattern: 'identifier', isRest: true };
      }

      default:
        return { name: text(node, source), pattern: 'identifier' };
    }
  };

  for (const param of paramsNode.namedChildren) {
    result.push(parse(param));
  }
  return result;
}

interface StructuredCall {
  callee: {
    type: 'identifier' | 'member_expression' | 'call_expression' | 'string';
    name?: string;
    object?: string;
    property?: string;
  };
  argsCount: number;
  startLine: number;
  endLine: number;
  arguments?: string[];
}

function getStructuredCalls(
  bodyNode: Node | null,
  source: string,
  callKinds: Set<string>
): StructuredCall[] {
  if (!bodyNode) return [];
  const calls = findNodesByTypes(bodyNode, callKinds);
  const result: StructuredCall[] = [];

  for (const call of calls) {
    const fnNode = call.childForFieldName('function');
    if (!fnNode) continue;

    const callee: any = { type: fnNode.type };
    if (fnNode.type === 'identifier') {
      callee.name = text(fnNode, source);
    } else if (fnNode.type === 'member_expression') {
      const obj = fnNode.childForFieldName('object');
      const prop = fnNode.childForFieldName('property');
      callee.object = obj ? text(obj, source) : '';
      callee.property = prop ? text(prop, source) : '';
      callee.name = `${callee.object}.${callee.property}`;
    } else if (fnNode.type === 'call_expression') {
      callee.type = 'call_expression';
      callee.name = text(fnNode, source);
    } else {
      callee.name = text(fnNode, source);
    }

    const argsNode = call.childForFieldName('arguments');
    const argsCount = argsNode ? argsNode.namedChildren.length : 0;

    result.push({
      callee,
      argsCount,
      startLine: call.startPosition.row + 1,
      endLine: call.endPosition.row + 1,
    });
  }
  return result;
}

function isFunctionExported(node: Node): boolean {
  let parent = node.parent;
  while (parent) {
    if (
      parent.type === 'export_statement' ||
      parent.type === 'export_named_declaration' ||
      parent.type === 'export_default_declaration'
    ) {
      return true;
    }
    if (parent.type === 'program') break;
    parent = parent.parent;
  }
  return false;
}

function getReturnTypeAnnotation(node: Node, source: string): string | null {
  const returnType = node.childForFieldName('return_type');
  if (returnType) {
    return text(returnType, source).replace(/^:\s*/, '');
  }
  return null;
}

export const findFunctions = (
  node: Node,
  source: string,
  language: string,
  includeBody: boolean
): any[] => {
  const config = AST_LANGUAGE_DECLARATIONS[language];
  if (!config?.functionKinds?.size) return [];

  const results: any[] = [];

  const traverse = (currentNode: Node) => {
    if (config.functionKinds.has(currentNode.type)) {
      const name = getRealFunctionName(currentNode, source);
      const isAsync =
        currentNode.type === 'arrow_function'
          ? source.slice(currentNode.startIndex, currentNode.startIndex + 5) === 'async'
          : !!currentNode.childForFieldName('async');

      const paramsNode = currentNode.childForFieldName('parameters');
      const params = getParamDetails(paramsNode, source);

      const bodyNode = currentNode.childForFieldName('body');
      const bodyPreview = includeBody && bodyNode ? text(bodyNode, source) : null;
      const calls = getStructuredCalls(bodyNode, source, config.callKinds);
      const parentType = currentNode.parent?.type ?? null;
      const nodeType =
        currentNode.type === 'arrow_function' && parentType === 'function_declaration'
          ? 'function_declaration'
          : currentNode.type;
      const parentNodeType =
        currentNode.type === 'arrow_function' && parentType === 'function_declaration'
          ? (currentNode.parent?.parent?.type ?? null)
          : parentType;

      const returnType = getReturnTypeAnnotation(currentNode, source);
      const exported = isFunctionExported(currentNode);

      results.push({
        name,
        type: currentNode.type,
        nodeType,
        parentNodeType,
        async: isAsync,
        exported,
        returnType,
        signature: text(currentNode, source).split('\n')[0]?.trim() ?? '',
        params,
        startLine: currentNode.startPosition.row + 1,
        endLine: currentNode.endPosition.row + 1,
        location: `${currentNode.startPosition.row + 1}:${currentNode.startPosition.column + 1}`,
        bodyPreview,
        calls,
      });
    }

    for (const child of currentNode.namedChildren) {
      traverse(child);
    }
  };

  traverse(node);
  return results;
};
