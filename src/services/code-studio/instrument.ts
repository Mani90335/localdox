// AST instrumentation: no regex rewriting or algorithm-name matching.
// Babel stays in a compiler worker; authored code runs in a separate opaque worker.
import type { NodePath } from "@babel/traverse";
import type * as Babel from "@babel/types";
type Transform = (source: string, options: Record<string, unknown>) => { code?: string | null };
export function instrument(transform: Transform, source: string): string {
  const result = transform(source, {
    sourceType: "script",
    filename: "main.js",
    plugins: [
      ({ types: t }: { types: typeof Babel }) => {
        let hook: Babel.Identifier;
        const generated = new WeakSet();
        const readers = (path: NodePath) =>
          t.arrayExpression(
            Object.keys(path.scope.getAllBindings())
              .filter((n) => n !== hook.name)
              .slice(0, 100)
              .map((name) =>
                t.arrayExpression([
                  t.stringLiteral(name),
                  t.arrowFunctionExpression([], t.identifier(name)),
                ]),
              ),
          );
        const tick = (path: NodePath, event: string) => {
          const node = t.expressionStatement(
            t.callExpression(t.memberExpression(hook, t.identifier("step")), [
              t.numericLiteral(path.node.loc?.start.line ?? 0),
              t.stringLiteral(event),
              readers(path),
            ]),
          );
          generated.add(node);
          return node;
        };
        return {
          visitor: {
            Program: {
              enter(path: NodePath<Babel.Program>) {
                hook = path.scope.generateUidIdentifier("studio");
              },
              exit(path: NodePath<Babel.Program>) {
                path.node.body.push(tick(path, "end"));
                path.node.body.unshift(
                  t.variableDeclaration("const", [
                    t.variableDeclarator(hook, t.identifier("__studio_runtime__")),
                  ]),
                );
              },
            },
            Identifier(path: NodePath<Babel.Identifier>) {
              if (path.node.name === "__studio_runtime__")
                throw path.buildCodeFrameError(
                  "The name __studio_runtime__ is reserved by the visualizer.",
                );
            },
            AwaitExpression(path: NodePath<Babel.AwaitExpression>) {
              throw path.buildCodeFrameError(
                "Async execution is not traced yet. Use a synchronous example.",
              );
            },
            Function: {
              enter(path: NodePath<Babel.Function>) {
                if (!path.node.loc) return;
                if (path.node.async || path.node.generator)
                  throw path.buildCodeFrameError(
                    "Async functions and generators are not traced yet.",
                  );
                if (!t.isBlockStatement(path.node.body))
                  path.node.body = t.blockStatement([
                    t.returnStatement(
                      t.callExpression(t.memberExpression(hook, t.identifier("returnValue")), [
                        t.numericLiteral(path.node.loc.start.line),
                        path.node.body,
                      ]),
                    ),
                  ]);
              },
              exit(path: NodePath<Babel.Function>) {
                if (!path.node.loc) return;
                const body = path.node.body as Babel.BlockStatement;
                const enter = t.expressionStatement(
                  t.callExpression(t.memberExpression(hook, t.identifier("enter")), [
                    t.stringLiteral(
                      ("id" in path.node && path.node.id?.name) ||
                        ("key" in path.node &&
                          t.isIdentifier(path.node.key) &&
                          path.node.key.name) ||
                        "anonymous",
                    ),
                    t.numericLiteral(path.node.loc?.start.line ?? 0),
                    readers(path),
                  ]),
                );
                const leave = t.expressionStatement(
                  t.callExpression(t.memberExpression(hook, t.identifier("leave")), []),
                );
                body.body = [
                  enter,
                  t.tryStatement(t.blockStatement(body.body), null, t.blockStatement([leave])),
                ];
              },
            },
            Loop: {
              exit(path: NodePath<Babel.Loop>) {
                if (!t.isBlockStatement(path.node.body))
                  path.node.body = t.blockStatement([path.node.body]);
                path.node.body.body.unshift(tick(path, "before"));
              },
            },
            ReturnStatement: {
              exit(path: NodePath<Babel.ReturnStatement>) {
                if (!path.node.loc) return;
                path.node.argument = t.callExpression(
                  t.memberExpression(hook, t.identifier("returnValue")),
                  [
                    t.numericLiteral(path.node.loc.start.line),
                    path.node.argument ?? t.unaryExpression("void", t.numericLiteral(0)),
                  ],
                );
              },
            },
            Statement: {
              exit(path: NodePath<Babel.Statement>) {
                if (
                  !path.node.loc ||
                  generated.has(path.node) ||
                  path.isBlockStatement() ||
                  path.isEmptyStatement() ||
                  path.isFunctionDeclaration()
                )
                  return;
                if (!path.inList || !["body", "consequent"].includes(path.listKey ?? "")) return;
                const before = tick(path, "before");
                // Insert only after original traversal so instrumentation never instruments itself.
                if (path.isVariableDeclaration() || path.isExpressionStatement())
                  path.insertAfter(tick(path, "after"));
                path.insertBefore(before);
              },
            },
          },
        };
      },
    ],
  });
  return result.code ?? "";
}
