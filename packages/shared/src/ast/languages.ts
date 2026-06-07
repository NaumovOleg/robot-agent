// languageConfig.ts
export const AST_LANGUAGE_DECLARATIONS: Record<
  string,
  {
    functionKinds: Set<string>;
    classKinds: Set<string>;
    importKinds: Set<string>;
    callKinds: Set<string>;
    objectPatternKeyKinds: Set<string>;
  }
> = {
  typescript: {
    functionKinds: new Set([
      'function_declaration',
      'function_expression',
      'generator_function_declaration',
      'generator_function',
      'method_definition',
      'method_signature',
      'abstract_method_signature',
      'arrow_function',
      'function',
      'constructor',
      'getter',
      'setter',
    ]),

    classKinds: new Set([
      'class_declaration',
      'abstract_class_declaration',
      'interface_declaration',
      'type_alias_declaration',
      'enum_declaration',
    ]),

    importKinds: new Set([
      'import_statement',
      'import_declaration',
      'import_clause',
      'namespace_import',
    ]),

    callKinds: new Set(['call_expression', 'new_expression', 'await_expression']),
    objectPatternKeyKinds: new Set(['pair', 'shorthand_property_identifier_pattern']),
  },

  tsx: {
    functionKinds: new Set([
      'function_declaration',
      'function_expression',
      'generator_function_declaration',
      'generator_function',
      'method_definition',
      'method_signature',
      'abstract_method_signature',
      'arrow_function',
      'function',
      'constructor',
      'getter',
      'setter',
    ]),

    classKinds: new Set([
      'class_declaration',
      'abstract_class_declaration',
      'interface_declaration',
      'type_alias_declaration',
      'enum_declaration',
    ]),

    importKinds: new Set([
      'import_statement',
      'import_declaration',
      'import_clause',
      'namespace_import',
    ]),

    callKinds: new Set([
      'call_expression',
      'new_expression',
      'await_expression',
      'jsx_self_closing_element',
      'jsx_element',
    ]),
    objectPatternKeyKinds: new Set(['pair', 'shorthand_property_identifier_pattern']),
  },

  javascript: {
    objectPatternKeyKinds: new Set(['pair', 'shorthand_property_identifier_pattern']),
    functionKinds: new Set([
      'function_declaration',
      'function_expression',
      'generator_function_declaration',
      'generator_function',
      'method_definition',
      'arrow_function',
      'function',
      'getter',
      'setter',
    ]),

    classKinds: new Set(['class_declaration']),

    importKinds: new Set(['import_statement', 'import_declaration']),

    callKinds: new Set(['call_expression', 'new_expression', 'await_expression']),
  },

  jsx: {
    objectPatternKeyKinds: new Set(['pair', 'shorthand_property_identifier_pattern']),
    functionKinds: new Set([
      'function_declaration',
      'function_expression',
      'generator_function_declaration',
      'generator_function',
      'method_definition',
      'arrow_function',
      'function',
      'getter',
      'setter',
    ]),

    classKinds: new Set(['class_declaration']),

    importKinds: new Set(['import_statement', 'import_declaration']),

    callKinds: new Set([
      'call_expression',
      'new_expression',
      'await_expression',
      'jsx_self_closing_element',
      'jsx_element',
    ]),
  },

  python: {
    objectPatternKeyKinds: new Set(),
    functionKinds: new Set(['function_definition', 'async_function_definition', 'lambda']),

    classKinds: new Set(['class_definition']),

    importKinds: new Set(['import_statement', 'import_from_statement']),

    callKinds: new Set(['call', 'await']),
  },

  go: {
    objectPatternKeyKinds: new Set(),
    functionKinds: new Set(['function_declaration', 'method_declaration', 'func_literal']),

    classKinds: new Set(['type_declaration', 'type_spec', 'struct_type', 'interface_type']),

    importKinds: new Set(['import_spec', 'import_declaration']),

    callKinds: new Set(['call_expression']),
  },

  rust: {
    objectPatternKeyKinds: new Set(),
    functionKinds: new Set(['function_item', 'closure_expression']),

    classKinds: new Set(['struct_item', 'enum_item', 'impl_item', 'trait_item', 'union_item']),

    importKinds: new Set(['use_declaration', 'extern_crate_declaration']),

    callKinds: new Set(['call_expression', 'macro_invocation']),
  },

  ruby: {
    objectPatternKeyKinds: new Set(),
    functionKinds: new Set(['method', 'singleton_method', 'lambda', 'block']),

    classKinds: new Set(['class', 'module', 'singleton_class']),

    importKinds: new Set(['require', 'require_relative']),

    callKinds: new Set(['call', 'method_call', 'command']),
  },

  java: {
    objectPatternKeyKinds: new Set(),
    functionKinds: new Set(['method_declaration', 'constructor_declaration', 'lambda_expression']),

    classKinds: new Set([
      'class_declaration',
      'interface_declaration',
      'enum_declaration',
      'annotation_type_declaration',
      'record_declaration',
    ]),

    importKinds: new Set(['import_declaration']),

    callKinds: new Set(['method_invocation', 'object_creation_expression']),
  },

  php: {
    objectPatternKeyKinds: new Set(),
    functionKinds: new Set([
      'function_definition',
      'method_declaration',
      'anonymous_function_creation_expression',
      'arrow_function',
    ]),

    classKinds: new Set([
      'class_declaration',
      'interface_declaration',
      'trait_declaration',
      'enum_declaration',
    ]),

    importKinds: new Set(['namespace_use_declaration', 'namespace_use_clause']),

    callKinds: new Set([
      'function_call_expression',
      'member_call_expression',
      'scoped_call_expression',
      'object_creation_expression',
    ]),
  },

  swift: {
    objectPatternKeyKinds: new Set(),
    functionKinds: new Set([
      'function_declaration',
      'initializer_declaration',
      'deinitializer_declaration',
      'closure_expression',
    ]),

    classKinds: new Set([
      'class_declaration',
      'struct_declaration',
      'enum_declaration',
      'protocol_declaration',
      'extension_declaration',
    ]),

    importKinds: new Set(['import_declaration']),

    callKinds: new Set(['call_expression']),
  },

  dart: {
    objectPatternKeyKinds: new Set(),
    functionKinds: new Set([
      'function_signature',
      'function_expression',
      'method_signature',
      'constructor_signature',
      'lambda_expression',
    ]),

    classKinds: new Set([
      'class_definition',
      'mixin_declaration',
      'extension_declaration',
      'enum_declaration',
    ]),

    importKinds: new Set(['import_specification', 'library_import']),

    callKinds: new Set(['method_invocation', 'argument_part', 'object_creation_expression']),
  },

  json: {
    objectPatternKeyKinds: new Set(),
    functionKinds: new Set(),
    classKinds: new Set(),
    importKinds: new Set(),
    callKinds: new Set(),
  },

  yaml: {
    objectPatternKeyKinds: new Set(),
    functionKinds: new Set(),
    classKinds: new Set(),
    importKinds: new Set(),
    callKinds: new Set(),
  },

  toml: {
    objectPatternKeyKinds: new Set(),
    functionKinds: new Set(),
    classKinds: new Set(),
    importKinds: new Set(),
    callKinds: new Set(),
  },
};
