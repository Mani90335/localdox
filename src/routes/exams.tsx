import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
const ExamApp = lazy(() => import("@/services/exams/ExamApp"));
export const Route = createFileRoute("/exams")({
  head: () => ({ meta: [{ title: "Exam Sessions · Localdox" }] }),
  component: () => (
    <Suspense fallback={<p>Loading Exam Sessions…</p>}>
      <ExamApp />
    </Suspense>
  ),
});
