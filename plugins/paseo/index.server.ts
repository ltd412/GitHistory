import type { PluginServerContext } from "@getpaseo/plugin/server";
import { browse, revision, snapshot, workspaces } from "./server/handlers";
import { disposeAll } from "./server/registry";
import { job, read, undoRedo, write } from "./server/actions";
import { tabs } from "./server/tabs";
import { searchDirs } from "./server/search-dirs";
import { browseRpc, historyRpc, jobRpc, readRpc, revisionRpc, searchDirsRpc, snapshotRpc, tabsRpc, workspacesRpc, writeRpc } from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  server.handle(revisionRpc, revision);
  server.handle(snapshotRpc, snapshot);
  server.handle(workspacesRpc, workspaces);
  server.handle(browseRpc, browse);
  server.handle(readRpc, read);
  server.handle(writeRpc, write);
  server.handle(jobRpc, job);
  server.handle(historyRpc, undoRedo);
  server.handle(tabsRpc, tabs);
  server.handle(searchDirsRpc, searchDirs);
  return () => disposeAll();
}
