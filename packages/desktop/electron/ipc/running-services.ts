import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { listSessionServices, stopSessionService } from "../session-services.ts";
export function registerRunningServicesIpc(window: () => BrowserWindow | null): void {
	const trusted = (event: IpcMainInvokeEvent, sessionId: unknown) => {
		if (event.sender !== window()?.webContents || event.senderFrame !== event.sender.mainFrame || typeof sessionId !== "string") throw new Error("无效的会话服务请求");
	};
	ipcMain.handle("services:list", (event, sessionId: string) => { trusted(event, sessionId); return listSessionServices(sessionId); });
	ipcMain.handle("services:stop", (event, sessionId: string, id: string, force: boolean) => {
		trusted(event, sessionId);
		if (typeof id !== "string" || typeof force !== "boolean") throw new Error("无效的停止请求");
		return stopSessionService(sessionId, id, force);
	});
}
