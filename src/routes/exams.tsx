import { createFileRoute } from "@tanstack/react-router";
import { DocsApp } from "@/components/docs/DocsApp";
export const Route = createFileRoute("/exams")({
  head: () => ({ meta: [{ title: "Exam Workspace - Localdox" }] }),
  component: () => <DocsApp initialExamWorkspace />,
});
