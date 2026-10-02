import { createFileRoute } from "@tanstack/react-router";
import { CodeStudio } from "@/components/code-studio/CodeStudio";

export const Route = createFileRoute("/code-studio")({
  head: () => ({
    meta: [
      { title: "Code Studio · Localdox" },
      {
        name: "description",
        content:
          "Explore code execution, memory, and computer science foundations one animated step at a time.",
      },
    ],
  }),
  component: CodeStudio,
});
