/**
 * The frame every page in a section shares. Kept here rather than repeated per
 * page so a new section inherits the measure and rhythm by using it, and so
 * changing either is one edit rather than one per route.
 */
export function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>;
}

export function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: React.ReactNode;
}) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {description ? (
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      ) : null}
    </header>
  );
}
