type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface XmlOptions {
  indent?: number;
  rootTag?: string;
  arrayItemTag?: string;
  nullValue?: string;
  attributeFields?: string[];
}

interface ArrayConfig {
  path: string;
  itemTag: string;
}

interface XmlOptions {
  indent?: number;
  rootTag?: string;
  arrayItemTag?: string;
  arrayConfigs?: ArrayConfig[];
  nullValue?: string;
  attributeFields?: string[];
  omitEmpty?: boolean;
}

const escape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const toKebab = (key: string): string => key.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`);

const sanitizeTag = (key: string): string =>
  toKebab(key)
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/^[^a-zA-Z_]/, 'x-$&')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const resolveItemTag = (
  currentPath: string,
  configs: ArrayConfig[],
  defaultTag: string
): string => {
  const match = configs.find((c) => c.path === currentPath);
  return match?.itemTag ?? defaultTag;
};

const renderValue = (
  value: JsonValue,
  tag: string,
  opts: Required<XmlOptions>,
  depth: number,
  currentPath: string
): string => {
  const pad = ' '.repeat(depth * opts.indent);

  if (opts.omitEmpty && (value === null || value === undefined)) return '';

  if (value === null || value === undefined) {
    return opts.nullValue ? `${pad}<${tag}>${escape(opts.nullValue)}</${tag}>` : `${pad}<${tag}/>`;
  }

  if (typeof value === 'string') return `${pad}<${tag}>${escape(value)}</${tag}>`;
  if (typeof value === 'number' || typeof value === 'boolean')
    return `${pad}<${tag}>${value}</${tag}>`;

  if (Array.isArray(value)) {
    if (opts.omitEmpty && value.length === 0) return '';
    if (value.length === 0) return `${pad}<${tag}/>`;

    const itemTag = resolveItemTag(currentPath, opts.arrayConfigs, opts.arrayItemTag);
    const innerPad = ' '.repeat((depth + 1) * opts.indent);

    const items = value
      .map((item) => {
        if (item === null || item === undefined) {
          if (opts.omitEmpty) return '';
          return `${innerPad}<${itemTag}/>`;
        }
        if (typeof item !== 'object') {
          return `${innerPad}<${itemTag}>${typeof item === 'string' ? escape(item) : item}</${itemTag}>`;
        }
        return renderObject(
          item as Record<string, JsonValue>,
          itemTag,
          opts,
          depth + 1,
          `${currentPath}[]`
        );
      })
      .filter(Boolean)
      .join('\n');

    return `${pad}<${tag}>\n${items}\n${pad}</${tag}>`;
  }

  return renderObject(value as Record<string, JsonValue>, tag, opts, depth, currentPath);
};

const renderObject = (
  obj: Record<string, JsonValue>,
  tag: string,
  opts: Required<XmlOptions>,
  depth: number,
  currentPath: string
): string => {
  const pad = ' '.repeat(depth * opts.indent);

  if (obj === null || obj === undefined) return `${pad}<${tag}/>`;

  const keys = Object.keys(obj);
  if (keys.length === 0) return `${pad}<${tag}/>`;

  const attrFields = new Set(opts.attributeFields);
  const attrEntries = keys.filter(
    (k) =>
      attrFields.has(k) &&
      (typeof obj[k] === 'string' || typeof obj[k] === 'number' || typeof obj[k] === 'boolean')
  );
  const childKeys = keys.filter((k) => !attrFields.has(k) || typeof obj[k] === 'object');

  const attrs = attrEntries.map((k) => ` ${sanitizeTag(k)}="${escape(String(obj[k]))}"`).join('');

  if (childKeys.length === 0) return `${pad}<${tag}${attrs}/>`;

  const children = childKeys
    .map((k) => {
      const childPath = currentPath ? `${currentPath}.${k}` : k;
      const rendered = renderValue(obj[k] as JsonValue, sanitizeTag(k), opts, depth + 1, childPath);
      return rendered;
    })
    .filter(Boolean)
    .join('\n');

  if (!children.trim()) return opts.omitEmpty ? '' : `${pad}<${tag}${attrs}/>`;

  return `${pad}<${tag}${attrs}>\n${children}\n${pad}</${tag}>`;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const jsonToXml = (value: any, options: XmlOptions = {}): string => {
  const opts: Required<XmlOptions> = {
    indent: options.indent ?? 2,
    rootTag: options.rootTag ?? 'root',
    arrayItemTag: options.arrayItemTag ?? 'item',
    arrayConfigs: options.arrayConfigs ?? [],
    nullValue: options.nullValue ?? '',
    attributeFields: options.attributeFields ?? [],
    omitEmpty: options.omitEmpty ?? false,
  };

  return renderValue(value, opts.rootTag, opts, 0, '');
};
