export function SectionCard({
  title,
  value,
  subtle,
}: {
  title: string;
  value: string;
  subtle?: string;
}) {
  return (
    <article className="stat-card">
      <span>{title}</span>
      <strong>{value}</strong>
      {subtle ? <p>{subtle}</p> : null}
    </article>
  );
}
