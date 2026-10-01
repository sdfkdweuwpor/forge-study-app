import { CROSS_FIELD_RULES, EXAMPLE_JSON, fieldDocs, type FieldDoc } from '@/logic/planImport'
import { Button } from '@/ui/Button'
import { Disclosure } from '@/ui'
import styles from './SchemaReference.module.css'

/** `goal.term.start` → "term": the object a field is required inside. */
function parentName(path: string): string {
  const cut = path.lastIndexOf('.')
  const parent = cut < 0 ? '' : path.slice(0, cut)
  return parent.slice(parent.lastIndexOf('.') + 1).replace(/\[\]$/, '') || 'its parent'
}

function requirement(doc: FieldDoc): string {
  if (doc.required === 'required') return 'Required'
  if (doc.required === 'optional') return 'Optional'
  return `Required in ${parentName(doc.path)}`
}

export interface SchemaReferenceProps {
  /** Puts the example into the editor (the caller also moves to the paste step). */
  onUseExample?(): void
}

/**
 * The import format, documented in the UI. Every row is generated from the Zod schema the validator
 * runs (`fieldDocs`), so this table cannot say something the validator does not enforce.
 */
export function SchemaReference({ onUseExample }: SchemaReferenceProps) {
  const docs = fieldDocs()
  return (
    <Disclosure title="Schema reference" ruled>
      <div className={styles.body}>
        <p className={styles.lede}>
          The JSON Forge accepts, generated from the same schema that checks your paste. Use{' '}
          <code>"forgePlan": 1</code>; other keys are rejected so a typo is never ignored silently.
        </p>

        <div className={styles.tableWrap} role="region" aria-label="Scrollable schema table">
          <table className={styles.table} aria-label="Schema fields">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Type</th>
                <th scope="col">Required</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.path}>
                  <th scope="row" className={styles.field}>
                    <code style={{ paddingLeft: `${d.depth * 12}px` }}>{d.path.split('.').at(-1)}</code>
                  </th>
                  <td className={styles.type}>{d.type}</td>
                  <td className={styles.req} data-required={d.required === 'required' || undefined}>
                    {requirement(d)}
                  </td>
                  <td>{d.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className={styles.subheading}>Rules across fields</h4>
        <ul className={styles.rules}>
          {CROSS_FIELD_RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>

        <h4 className={styles.subheading}>Example</h4>
        <pre className={styles.example}>
          <code>{EXAMPLE_JSON}</code>
        </pre>
        {onUseExample ? (
          <Button variant="secondary" size="sm" onClick={onUseExample}>
            Try this example
          </Button>
        ) : null}
      </div>
    </Disclosure>
  )
}
