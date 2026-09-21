import type { ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'

import '~/app/AppLayout.css'

type NavItem = {
  to: string
  labelKey: string
  icon: ReactNode
}

const items: NavItem[] = [
  {
    to: '/',
    labelKey: 'Camera',
    icon: (
      <svg className="shell__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 8.5h3l1.5-2h7L17 8.5h3v10H4v-10Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="13" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    to: '/gallery',
    labelKey: 'Gallery',
    icon: (
      <svg className="shell__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3.5" y="4" width="7" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
        <rect
          x="13.5"
          y="4"
          width="7"
          height="6"
          rx="1.6"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <rect
          x="3.5"
          y="15"
          width="7"
          height="5"
          rx="1.6"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <rect
          x="13.5"
          y="12"
          width="7"
          height="8"
          rx="1.6"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    ),
  },
  {
    to: '/settings',
    labelKey: 'Settings',
    icon: (
      <svg className="shell__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M12 3.6v2M12 18.4v2M20.4 12h-2M5.6 12h-2M17.9 6.1l-1.4 1.4M7.5 16.5l-1.4 1.4M17.9 17.9l-1.4-1.4M7.5 7.5 6.1 6.1"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
]

export function AppLayout() {
  const { pathname } = useLocation()
  // The camera view is full-bleed and carries its own controls.
  const immersive = pathname === '/'

  return (
    <div className="shell">
      <div className="shell__content">
        <Outlet />
      </div>
      <nav className="shell__nav" data-hidden={immersive}>
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className="shell__link">
            {item.icon}
            <span>{item.labelKey}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
