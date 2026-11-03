// Opens a page in a person's browser, on a command they ran by hand. No shell, and it's only ever
// this server's own address.
import { spawn } from "node:child_process";

export function openInBrowser(url: string): void {
  const [command, ...args] =
    process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  const child = spawn(command!, args, { stdio: "ignore", detached: true });
  // The address is printed either way, so a browser that can't open costs nothing.
  child.once("error", () => {});
  child.unref();
}
