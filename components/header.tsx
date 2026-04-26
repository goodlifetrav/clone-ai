'use client'

import Link from 'next/link'
import { useTheme } from '@/hooks/use-theme'
import { Button } from '@/components/ui/button'
import { Moon, Sun, Zap, FolderOpen, Settings, LogOut } from 'lucide-react'
import { useUser, useClerk, SignInButton, UserButton } from '@clerk/nextjs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

export function Header() {
  const { toggleTheme, isDark } = useTheme()
  const { isSignedIn, user } = useUser()
  const { signOut } = useClerk()

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 border-b border-neutral-200/80 bg-white/80 backdrop-blur-md dark:border-neutral-800/80 dark:bg-neutral-950/80">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
        <div className="w-7 h-7 rounded-lg bg-neutral-900 dark:bg-white flex items-center justify-center">
          <Zap className="w-4 h-4 text-white dark:text-neutral-900" />
        </div>
        <span className="dark:text-white">CloneAI</span>
      </Link>

      {/* Nav */}
      <nav className="hidden md:flex items-center gap-6 text-sm text-neutral-600 dark:text-neutral-400">
        <Link href="/pricing" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
          Pricing
        </Link>
        {isSignedIn && (
          <Link href="/dashboard" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
            Dashboard
          </Link>
        )}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Theme toggle */}
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>

        {isSignedIn ? (
          <UserDropdown user={user} onSignOut={() => signOut()} />
        ) : (
          <div className="flex items-center gap-2">
            <SignInButton mode="modal">
              <Button variant="ghost" size="sm">Sign in</Button>
            </SignInButton>
            <SignInButton mode="modal">
              <Button size="sm">Get started</Button>
            </SignInButton>
          </div>
        )}
      </div>
    </header>
  )
}

function UserDropdown({
  user,
  onSignOut,
}: {
  user: ReturnType<typeof useUser>['user']
  onSignOut: () => void
}) {
  const initials = user?.firstName
    ? `${user.firstName[0]}${user.lastName?.[0] || ''}`.toUpperCase()
    : user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() || 'U'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white">
          <Avatar className="w-8 h-8">
            <AvatarImage src={user?.imageUrl} alt={user?.fullName || 'User'} />
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="font-medium">{user?.fullName || 'User'}</div>
          <div className="text-xs text-neutral-500 font-normal truncate">
            {user?.emailAddresses?.[0]?.emailAddress}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard" className="cursor-pointer">
            <FolderOpen className="w-4 h-4 mr-2" />
            My Projects
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer">
            <Settings className="w-4 h-4 mr-2" />
            Account Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/pricing" className="cursor-pointer">
            <Zap className="w-4 h-4 mr-2" />
            Upgrade Plan
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-red-600 dark:text-red-400 cursor-pointer"
          onClick={onSignOut}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
