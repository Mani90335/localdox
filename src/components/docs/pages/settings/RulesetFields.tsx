import { useId } from "react";
import { z } from "zod";

import { fieldLabel, seed, unwrap } from "./ruleset-fields";

const inputClass =
  "min-h-9 w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm";
const smallButton =
  "rounded-md border border-border px-2 py-1 text-xs hover:bg-accent coarse:min-h-11";

export function RulesetField({
  schema,
  value,
  onChange,
  label,
  path = label,
  unsetLabel,
}: {
  schema: z.ZodTypeAny;
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
  path?: string;
  unsetLabel?: string;
}) {
  const id = useId();
  if (value === undefined && schema instanceof z.ZodDefault) value = seed(schema);
  const type = unwrap(schema);
  const optional = schema.isOptional() && !(schema instanceof z.ZodDefault);
  const nullable = schema.isNullable();
  const absent = value === undefined || value === null;
  const children = (
    child: z.ZodTypeAny,
    v: unknown,
    change: (next: unknown) => void,
    name: string,
    key: string,
  ) => (
    <RulesetField
      key={key}
      schema={child}
      value={v}
      onChange={change}
      label={name}
      path={`${path} · ${name}`}
    />
  );
  let control;
  if (type instanceof z.ZodLiteral)
    control = (
      <output id={id} className="text-xs text-muted-foreground">
        {String(type.value)}
      </output>
    );
  else if (type instanceof z.ZodObject) {
    const record = (value ?? {}) as Record<string, unknown>;
    control = (
      <div className="space-y-3 border-l border-border pl-3">
        {Object.entries(type.shape as Record<string, z.ZodTypeAny>).map(([key, child]) =>
          children(
            child,
            record[key],
            (v) => onChange({ ...record, [key]: v }),
            fieldLabel(key),
            key,
          ),
        )}
      </div>
    );
  } else if (type instanceof z.ZodUnion) {
    const options = type.options as z.ZodTypeAny[];
    const index = Math.max(
      0,
      options.findIndex(
        (s) =>
          s.safeParse(value).success ||
          (unwrap(s) instanceof z.ZodObject &&
            value &&
            typeof value === "object" &&
            Object.keys((unwrap(s) as z.AnyZodObject).shape).some((k) => Object.hasOwn(value, k))),
      ),
    );
    control = (
      <div className="space-y-2">
        <select
          id={id}
          aria-label={`${path} format`}
          className={inputClass}
          value={index}
          onChange={(e) => onChange(seed(options[Number(e.target.value)]))}
        >
          {options.map((s, i) => {
            const t = unwrap(s);
            return (
              <option key={i} value={i}>
                {t instanceof z.ZodObject
                  ? Object.keys(t.shape).map(fieldLabel).join(" / ")
                  : t instanceof z.ZodArray
                    ? "List"
                    : t instanceof z.ZodNull
                      ? "None"
                      : t._def.typeName.replace("Zod", "")}
              </option>
            );
          })}
        </select>
        {!(unwrap(options[index]) instanceof z.ZodNull) &&
          children(options[index], value, onChange, "Value", String(index))}
      </div>
    );
  } else if (type instanceof z.ZodArray || type instanceof z.ZodTuple) {
    const values = Array.isArray(value) ? value : [];
    control = (
      <div className="space-y-2">
        {values.map((v, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {children(
                type instanceof z.ZodArray ? type.element : type.items[i],
                v,
                (next) => onChange(values.map((old, n) => (n === i ? next : old))),
                `Item ${i + 1}`,
                String(i),
              )}
            </div>
            {type instanceof z.ZodArray && (
              <button
                type="button"
                className={smallButton}
                aria-label={`Remove ${path} item ${i + 1}`}
                onClick={() => onChange(values.filter((_, n) => n !== i))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {type instanceof z.ZodArray && (
          <button
            type="button"
            className={smallButton}
            onClick={() => onChange([...values, seed(type.element)])}
          >
            Add {label.toLowerCase()} item
          </button>
        )}
      </div>
    );
  } else if (type instanceof z.ZodBoolean)
    control = (
      <input
        id={id}
        aria-label={path}
        type="checkbox"
        className="size-4 accent-primary"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  else if (type instanceof z.ZodEnum)
    control = (
      <select
        id={id}
        aria-label={path}
        className={inputClass}
        value={String(value ?? type.options[0])}
        onChange={(e) => onChange(e.target.value)}
      >
        {type.options.map((v: string) => (
          <option key={v} value={v}>
            {fieldLabel(v)}
          </option>
        ))}
      </select>
    );
  else if (type instanceof z.ZodNumber)
    control = (
      <input
        id={id}
        aria-label={path}
        className={inputClass}
        type="number"
        min={type.minValue ?? undefined}
        max={type.maxValue ?? undefined}
        step={type.isInt ? 1 : "any"}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />
    );
  else if (/summary|instructions|advice/i.test(path) || String(value ?? "").includes("\n"))
    control = (
      <textarea
        id={id}
        aria-label={path}
        className={inputClass}
        rows={3}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  else
    control = (
      <input
        id={id}
        aria-label={path}
        className={inputClass}
        type="text"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
        {(optional || nullable) && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              aria-label={`Set ${path}`}
              checked={!absent}
              onChange={(e) =>
                onChange(e.target.checked ? seed(type) : optional ? undefined : null)
              }
            />
            {nullable ? (type instanceof z.ZodNumber ? "Set a limit" : "Enable") : "Customize"}
          </label>
        )}
      </div>
      {absent && (optional || nullable) ? (
        <p className="text-xs text-muted-foreground">
          {nullable
            ? type instanceof z.ZodNumber
              ? "No limit"
              : "None"
            : (unsetLabel ?? "Default / not set")}
        </p>
      ) : (
        control
      )}
    </div>
  );
}
