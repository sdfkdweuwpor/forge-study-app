import { X } from 'lucide-react'
import { IconButton } from '@/ui/IconButton'
import { Link, useRoute } from '../router'
import { Drawer } from './Drawer'
import styles from './MoreSheet.module.css'
import { MORE_NAV, isNavActive } from './nav'

/** The "More" tab of the mobile bar: everything that does not fit in four tabs. */
export function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const route = useRoute()
  return (
    <Drawer open={open} onClose={onClose} label="More" side="bottom">
      <div className={styles.header}>
        <h2 className={styles.title}>More</h2>
        {/* Touch only, so no tooltip; the hit area is the full 44px. */}
        <IconButton
          className={styles.close}
          label="Close"
          icon={<X />}
          size="md"
          tooltip={false}
          onClick={onClose}
        />
      </div>
      <ul className={styles.list}>
        {MORE_NAV.map((item) => {
          const active = isNavActive(item, route.name)
          const Icon = item.icon
          return (
            <li key={item.id}>
              <Link
                to={item.to}
                className={styles.row}
                aria-current={active ? 'page' : undefined}
                data-active={active || undefined}
                onClick={onClose}
              >
                <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </Drawer>
  )
}
