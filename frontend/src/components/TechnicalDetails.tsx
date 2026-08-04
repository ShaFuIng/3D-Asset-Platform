type TechnicalDetailsProps = {
  items: Array<[label: string, value: string | null | undefined]>;
};

// Collapsible container for developer-facing identifiers (image_id, job_id,
// prompt_id, ...). Keeps technical noise out of the main visual hierarchy
// while staying available for debugging.
export function TechnicalDetails({ items }: TechnicalDetailsProps) {
  const visibleItems = items.filter(([, value]) => value);
  if (visibleItems.length === 0) {
    return null;
  }
  return (
    <details className="technical-details">
      <summary>Technical Details／技術資訊</summary>
      <dl>
        {visibleItems.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <code>{value}</code>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
