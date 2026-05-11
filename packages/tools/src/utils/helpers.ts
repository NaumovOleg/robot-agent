export const formatToolDescription = (name: string, args: Record<string, unknown>): string => {
  if (name === 'bash') return `$ ${args.command}`;
  if (name === 'write_file') return `write ${args.path}`;
  if (name === 'edit_file') return `edit ${args.path}`;
  if (name === 'read_file') return `read ${args.path}`;
  return `${name}(${JSON.stringify(args)})`;
};
