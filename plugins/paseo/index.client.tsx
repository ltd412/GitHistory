import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "./client/ui/sdk";
import { GitScreen } from "./client/GitScreen";

// Entry point (dinh-chinh-01): a "Git" item in Paseo's main sidebar opens the Git screen.
function GitSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="GitBranch" active={currentScreen?.screenId === "git"} onPress={() => openScreen({ screenId: "git" })} />;
}

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addScreen({ id: "git", title: "Git", Component: GitScreen }),
    client.addSidebarHeaderItem({ id: "git", title: "Git", Component: GitSidebarItem }),
    client.addCommandCenterItem({
      id: "open-git",
      title: "Open Git",
      icon: "GitBranch",
      keywords: ["git", "graph", "commit", "branch"],
      context: "global",
      onSelect({ openScreen }) {
        openScreen({ screenId: "git" });
      },
    }),
  ];
  return () => cleanups.forEach((c) => c());
}
