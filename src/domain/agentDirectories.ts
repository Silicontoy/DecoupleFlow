export type DirectoryAgent = 'codex' | 'claude';
export const DIRECTORY_AGENT_LABELS: Record<DirectoryAgent, string> = { codex: 'Codex', claude: 'Claude Code' };
export type DirectorySource = { agent: DirectoryAgent; label: string; file: string; userHome: string };
export type AgentProjectDirectory = { path: string; originalPath: string; name: string; available: boolean; status: string; lastUsed: string | null; sources: DirectorySource[] };
export type AgentUserDirectory = { agent: DirectoryAgent; userHome: string; configDirectory: string };
export type AgentDirectories = { projects: AgentProjectDirectory[]; profiles: AgentUserDirectory[]; notes: string[]; scannedAt: string };
