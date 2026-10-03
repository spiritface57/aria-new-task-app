import { useFamily } from '../hooks/FamilyContext';

/** For parents with more than one child: everyone, or one child. */
export function ChildFilter({ value, onChange }: { value: string | null; onChange(id: string | null): void }) {
  const { activeChildren } = useFamily();
  if (activeChildren.length < 2) return null;
  return (
    <div className="chips" role="group" aria-label="Show">
      <button className="chip" aria-pressed={value === null} onClick={() => onChange(null)}>Everyone</button>
      {activeChildren.map((c) => (
        <button key={c.id} className="chip" aria-pressed={value === c.id} onClick={() => onChange(c.id)}>
          {c.display_name}
        </button>
      ))}
    </div>
  );
}
