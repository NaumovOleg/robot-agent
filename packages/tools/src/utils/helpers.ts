export const formatToolDescription = (name: string, args: Record<string, unknown>): string => {
  if (name === 'bash') return `$ ${args.command}`;
  if (name === 'write_file') return `write ${args.path}`;
  if (name === 'edit_file') return `edit ${args.path}`;
  if (name === 'patch_file') return `patch ${args.path}`;
  if (name === 'read_file') return `read ${args.path}`;
  if (name === 'delegate_to_reader') return `delegate subagent: ${args.task}`;
  if (name === 'delegate_to_writer') return `delegate writer: ${args.task}`;
  if (name === 'delegate_to_git') return `delegate git: ${args.task}`;
  if (name === 'validate_project') return 'run project validation';
  return `${name}(${JSON.stringify(args)})`;
};
