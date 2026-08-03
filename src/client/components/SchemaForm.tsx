type JsonSchema = {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
};

interface SchemaFormProps {
  schema?: JsonSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}

export function SchemaForm({ schema, value, onChange }: SchemaFormProps) {
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  if (!Object.keys(properties).length) {
    return <div className="empty-inline compact">This tool accepts no arguments.</div>;
  }
  return (
    <div className="schema-form">
      {Object.entries(properties).map(([name, field]) => (
        <SchemaField
          key={name}
          name={name}
          schema={field}
          required={required.has(name)}
          value={value[name]}
          onChange={(next) => onChange({ ...value, [name]: next })}
        />
      ))}
    </div>
  );
}

function SchemaField({ name, schema, required, value, onChange }: {
  name: string;
  schema: JsonSchema;
  required: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `field-${name}`;
  const label = schema.title || name;
  let control;
  if (schema.enum) {
    control = (
      <select id={id} value={value == null ? "" : String(value)} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select a value</option>
        {schema.enum.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
      </select>
    );
  } else if (schema.type === "boolean") {
    control = (
      <label className="switch-row">
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span>{value ? "true" : "false"}</span>
      </label>
    );
  } else if (schema.type === "number" || schema.type === "integer") {
    control = (
      <input id={id} type="number" value={value == null ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))} />
    );
  } else if (schema.type === "object" || schema.type === "array") {
    control = (
      <textarea
        id={id}
        rows={4}
        value={value == null ? "" : JSON.stringify(value, null, 2)}
        placeholder={schema.type === "array" ? "[]" : "{}"}
        onChange={(event) => {
          try { onChange(JSON.parse(event.target.value)); } catch { /* keep the last valid value */ }
        }}
      />
    );
  } else {
    control = <input id={id} value={value == null ? "" : String(value)} onChange={(event) => onChange(event.target.value)} />;
  }
  return (
    <div className="field-block">
      <label htmlFor={id}>{label}{required && <span className="required"> *</span>}</label>
      {schema.description && <p>{schema.description}</p>}
      {control}
    </div>
  );
}
