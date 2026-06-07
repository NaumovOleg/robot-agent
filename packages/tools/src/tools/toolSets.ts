import { READER_TOOLS_SET } from './reader';
import { EDITOR_TOOLS_SET } from './editor';
import { GIT_READ_TOOLS_SET, GIT_TOOLS_SET } from './git';

export const WRITER_TOOLS_SET = [...EDITOR_TOOLS_SET];
export const GIT_ONLY_TOOLS_SET = [...GIT_TOOLS_SET];

export const READER_TOOLS = [...READER_TOOLS_SET, ...GIT_READ_TOOLS_SET];
export const WRITER_TOOLS = WRITER_TOOLS_SET;
export const GIT_TOOLS = GIT_ONLY_TOOLS_SET;
