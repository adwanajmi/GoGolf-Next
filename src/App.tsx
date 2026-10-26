import { useEffect, useState } from 'react'
import { ArrowRight, CalendarDays, FlagTriangleRight, LogOut, Menu, MessageSquare, Newspaper, Search, Settings2, Trophy, UserRound, X } from 'lucide-react'
import { api, type User } from './api'
import { Discovery, ClubPage, CoursePage, ReviewsPage } from './pages/Discovery'
import { BookingPage, CheckoutPage, MyBookings } from './pages/Booking'
import { AuthPage, ProfilePage, ScoresPage, JournalPage } from './pages/Account'
import { AdminPage } from './pages/Admin'
import './App.css'

const initialRoute = () => location.hash.slice(1) || 'discover'

function App() {
  const [route, setRoute] = useState(initialRoute)
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [menu, setMenu] = useState(false)
  useEffect(() => { const onHash = () => setRoute(initialRoute()); window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash) }, [])
  useEffect(() => { api<{ user: User | null }>('/auth/me').then(data => { setUser(data.user); setError('') }).catch(error => setError(error.message)).finally(() => setReady(true)) }, [])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer) }, [toast])
  function go(next: string) { location.hash = next; setRoute(next); setMenu(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  function notify(message: string) { setToast(message) }
  async function logout() { await api('/auth/logout', 'POST', {}); setUser(null); notify('Signed out'); go('discover') }
  const [page, slug] = route.split('/')
  const shared = { go, user, notify }
  const requireAccount = (content: React.ReactNode) => !ready ? <p className="notice">Checking your account…</p> : user ? content : <div className="protected-note"><UserRound size={27} /><h2>Sign in to continue</h2><p>Your bookings, scorecards, and profile belong to your account.</p><button className="button primary" onClick={() => go('auth')}>Sign in <ArrowRight size={16} /></button></div>
  const nav = [
    { label: 'Find clubs', route: 'discover', icon: Search },
    { label: 'Tee times', route: 'book/kde-main', icon: CalendarDays },
    { label: 'Reviews', route: 'reviews/kde-main', icon: MessageSquare },
    { label: 'Club notes', route: 'journal', icon: Newspaper },
    ...(user ? [{ label: 'My bookings', route: 'bookings', icon: FlagTriangleRight }, { label: 'Scorecards', route: 'scores', icon: Trophy }, { label: 'Profile', route: 'profile', icon: UserRound }] : []),
    ...(user?.role === 'admin' ? [{ label: 'Club admin', route: 'admin', icon: Settings2 }] : []),
  ]
  const active = (target: string) => route === target || route.startsWith(`${target.split('/')[0]}/`)
  let content: React.ReactNode
  if (page === 'discover' || page === 'overview') content = <Discovery {...shared} />
  else if (page === 'club' && slug) content = <ClubPage {...shared} clubId={slug} />
  else if (page === 'course' && slug) content = <CoursePage {...shared} courseId={slug} />
  else if (page === 'book' && slug) content = <BookingPage key={slug} {...shared} courseId={slug} />
  else if (page === 'reviews' && slug) content = <ReviewsPage key={slug} {...shared} courseId={slug} />
  else if (page === 'checkout' && slug) content = requireAccount(<CheckoutPage {...shared} bookingId={slug} />)
  else if (page === 'bookings') content = requireAccount(<MyBookings {...shared} />)
  else if (page === 'scores') content = requireAccount(<ScoresPage {...shared} />)
  else if (page === 'profile') content = requireAccount(<ProfilePage {...shared} onAuth={setUser} />)
  else if (page === 'journal') content = <JournalPage />
  else if (page === 'auth') content = <AuthPage {...shared} onAuth={setUser} />
  else if (page === 'admin') content = !ready ? <p className="notice">Checking admin access…</p> : user?.role === 'admin' ? <AdminPage notify={notify} /> : <div className="protected-note"><Settings2 size={27} /><h2>Admin access required</h2><p>This area is only available to administrators verified by the GoGolf server.</p><button className="button primary" onClick={() => go('discover')}>Back to clubs</button></div>
  else content = <div className="protected-note"><h2>Page not found</h2><button className="button primary" onClick={() => go('discover')}>Browse clubs</button></div>
  return <div className="app-shell"><header className="site-header"><button className="brand" onClick={() => go('discover')} aria-label="GoGolf home"><span className="brand-symbol"><FlagTriangleRight size={23} /></span><span>GoGolf<small>THE CLUBHOUSE</small></span></button><button className="menu-toggle" aria-label={menu ? 'Close menu' : 'Open menu'} onClick={() => setMenu(!menu)}>{menu ? <X size={23} /> : <Menu size={23} />}</button><nav className={menu ? 'show' : ''} aria-label="Main navigation">{nav.map(item => { const Icon = item.icon; return <button key={item.route} className={active(item.route) ? 'active' : ''} onClick={() => go(item.route)}><Icon size={16} /> {item.label}</button> })}</nav><div className="header-account">{user ? <><button onClick={() => go('profile')}>{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span className="initials">{user.name.slice(0,2).toUpperCase()}</span>}<span>{user.name}</span></button><button className="logout" onClick={logout} aria-label="Sign out"><LogOut size={17} /></button></> : <button className="button header-signin" onClick={() => go('auth')}>Sign in</button>}</div></header><main>{error && <div className="global-error" role="alert">{error}<button onClick={() => location.reload()}>Retry</button></div>}{content}</main><footer className="site-footer"><div><strong>GoGolf</strong><p>A portfolio evolution of the original Kelab Darul Ehsan FYP.</p></div><span>Local demonstration · No live club inventory or payments</span><button onClick={() => go('discover')}>Browse clubs <ArrowRight size={15} /></button></footer>{toast && <div className="toast" role="status">{toast}<button onClick={() => setToast('')} aria-label="Dismiss message"><X size={16} /></button></div>}</div>
}

export default App
