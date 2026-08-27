"use client";

/**
 * CLIENT: the dropdown's open/closed state and keyboard/focus handling
 * require client-side interactivity (plan §4, F4). The sign-out mechanism
 * itself does not — it is a plain `<form action={submitSignOut}>` that
 * works with JavaScript disabled; only the surrounding menu chrome is why
 * this file needs "use client".
 */

import { LogOut, UserRound } from "lucide-react";

import { submitSignOut } from "@/lib/auth/actions";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ email }: { email?: string | null }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className={buttonVariants({
          variant: "ghost",
          size: "icon",
          className: "size-11 rounded-full",
        })}
      >
        <UserRound className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {email ? (
          <>
            <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          variant="destructive"
          closeOnClick={false}
          render={<form action={submitSignOut} />}
        >
          <button
            type="submit"
            className="flex w-full min-h-11 items-center gap-1.5 text-left"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
