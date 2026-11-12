import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type BoothBridge } from '@booth/contracts';

/**
 * Builds the narrow, role-specific bridge. Only named channels are reachable;
 * renderers never see ipcRenderer, Node, or filesystem APIs. Every payload is
 * validated again in the main process.
 */
function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_e: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const notAllowed = (name: string) => () => {
  throw new Error(`${name} is not available in this window`);
};

export function exposeBridge(role: 'participant' | 'operator' | 'leaderboard'): void {
  const participant = role === 'participant';
  const operator = role === 'operator';
  const leaderboard = role === 'leaderboard';
  const bridge: BoothBridge = {
    role,
    getBootstrap: () => ipcRenderer.invoke(IPC.getBootstrap),
    log: (entry) => ipcRenderer.send(IPC.log, entry),
    onSettingsChanged: (l) => subscribe(IPC.settingsChanged, l),

    sendStatus: participant ? (s) => ipcRenderer.send(IPC.participantStatus, s) : notAllowed('sendStatus'),
    sendSessionRecord: participant ? (r) => ipcRenderer.send(IPC.sessionRecord, r) : notAllowed('sendSessionRecord'),
    onCommand: participant ? (l) => subscribe(IPC.participantCommand, l) : notAllowed('onCommand'),

    sendCommand: operator ? (c) => ipcRenderer.send(IPC.operatorCommand, c) : notAllowed('sendCommand'),
    updateSettings: operator ? (p) => ipcRenderer.invoke(IPC.updateSettings, p) : notAllowed('updateSettings'),
    exportDiagnostics: operator ? () => ipcRenderer.invoke(IPC.exportDiagnostics) : notAllowed('exportDiagnostics'),
    getErrorHistory: operator ? () => ipcRenderer.invoke(IPC.getErrorHistory) : notAllowed('getErrorHistory'),
    reloadParticipant: operator ? () => ipcRenderer.invoke(IPC.reloadParticipant) : notAllowed('reloadParticipant'),
    onStatus: operator ? (l) => subscribe(IPC.operatorStatus, l) : notAllowed('onStatus'),

    openLeaderboard: leaderboard ? notAllowed('openLeaderboard') : () => ipcRenderer.invoke(IPC.openLeaderboard),
    getLeaderboard: () => ipcRenderer.invoke(IPC.getLeaderboard),
    onLeaderboardUpdated: (l) => subscribe(IPC.leaderboardUpdated, l),
    leaderboardWindow: participant ? notAllowed('leaderboardWindow') : (c) => ipcRenderer.invoke(IPC.leaderboardWindow, c),
    listDisplays: participant ? notAllowed('listDisplays') : () => ipcRenderer.invoke(IPC.listDisplays),

    registerPlayers: participant ? (players) => ipcRenderer.invoke(IPC.registerPlayers, { players }) : notAllowed('registerPlayers'),
    lookupPlayerNumber: participant ? (slot, number) => ipcRenderer.invoke(IPC.lookupPlayerNumber, { slot, number }) : notAllowed('lookupPlayerNumber'),
    onPlayerEntry: operator ? (l) => subscribe(IPC.playerEntry, l) : notAllowed('onPlayerEntry'),
    getFeedStatus: operator ? () => ipcRenderer.invoke(IPC.getFeedStatus) : notAllowed('getFeedStatus'),
    regenerateFeedKey: operator ? () => ipcRenderer.invoke(IPC.regenerateFeedKey) : notAllowed('regenerateFeedKey'),
    revealFeedKey: operator ? () => ipcRenderer.invoke(IPC.revealFeedKey) : notAllowed('revealFeedKey'),
    copyFeedKey: operator ? () => ipcRenderer.invoke(IPC.copyFeedKey) : notAllowed('copyFeedKey'),
    copyText: operator ? (text) => ipcRenderer.invoke(IPC.copyText, { text }) : notAllowed('copyText'),
    getFeedLog: operator ? () => ipcRenderer.invoke(IPC.getFeedLog) : notAllowed('getFeedLog'),
    onFeedToast: operator ? (l) => subscribe(IPC.feedToast, l) : notAllowed('onFeedToast'),
    clearLeaderboard: operator ? () => ipcRenderer.invoke(IPC.clearLeaderboard) : notAllowed('clearLeaderboard'),

    centralGetStatus: operator ? () => ipcRenderer.invoke(IPC.centralGetStatus) : notAllowed('centralGetStatus'),
    onCentralStatus: operator ? (l) => subscribe(IPC.centralStatusChanged, l) : notAllowed('onCentralStatus'),
    centralUpdateConfig: operator ? (p) => ipcRenderer.invoke(IPC.centralUpdateConfig, p) : notAllowed('centralUpdateConfig'),
    centralSetCredential: operator ? (credential) => ipcRenderer.invoke(IPC.centralSetCredential, { credential }) : notAllowed('centralSetCredential'),
    centralTestConnection: operator ? () => ipcRenderer.invoke(IPC.centralTestConnection) : notAllowed('centralTestConnection'),
    centralResolve: operator ? (slot, code) => ipcRenderer.invoke(IPC.centralResolve, { slot, code }) : notAllowed('centralResolve'),
    centralConfirm: operator ? (slot) => ipcRenderer.invoke(IPC.centralConfirm, { slot }) : notAllowed('centralConfirm'),
    centralClearSlot: operator ? (slot) => ipcRenderer.invoke(IPC.centralClearSlot, { slot }) : notAllowed('centralClearSlot'),
    centralRetry: operator ? (resultId) => ipcRenderer.invoke(IPC.centralRetry, resultId ? { resultId } : {}) : notAllowed('centralRetry'),
    centralReconcile: operator ? () => ipcRenderer.invoke(IPC.centralReconcile) : notAllowed('centralReconcile'),
    centralEditResult: operator ? (edit) => ipcRenderer.invoke(IPC.centralEditResult, edit) : notAllowed('centralEditResult'),
    centralResolveUnresolved: operator ? (resultId, code) => ipcRenderer.invoke(IPC.centralResolveUnresolved, { resultId, code }) : notAllowed('centralResolveUnresolved'),
    centralGetPlayers: participant ? () => ipcRenderer.invoke(IPC.centralGetPlayers) : notAllowed('centralGetPlayers'),
    onCentralPlayers: participant ? (l) => subscribe(IPC.centralPlayersChanged, l) : notAllowed('onCentralPlayers'),
  };
  contextBridge.exposeInMainWorld('booth', bridge);
}
