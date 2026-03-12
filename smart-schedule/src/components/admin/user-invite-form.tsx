import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "@/components/ui/popover";
import { Loader2, UserPlus, Search } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "@/hooks/use-current-site";
import { useDirectorySearch, type DirectoryUser } from "@/hooks/use-directory-search";

interface UserInviteFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserInviteForm({ open, onOpenChange }: UserInviteFormProps) {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("member");
  const [searchInput, setSearchInput] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: directoryUsers = [], isLoading: isSearching } = useDirectorySearch(searchInput);

  function handleSelectUser(dirUser: DirectoryUser) {
    const userEmail = dirUser.mail || dirUser.userPrincipalName;
    const fullName =
      dirUser.displayName ||
      [dirUser.givenName, dirUser.surname].filter(Boolean).join(" ") ||
      "";
    const selectedLabel = fullName || userEmail;
    setEmail(userEmail);
    setDisplayName(fullName);
    setSearchInput(selectedLabel);
    setPickerOpen(false);
  }

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (value.length >= 2) {
      setPickerOpen(true);
    } else {
      setPickerOpen(false);
    }
  }

  const addUser = useMutation({
    mutationFn: async () => {
      if (!site) throw new Error("No site selected");
      if (!user || (user.role !== "site_admin" && user.role !== "super_admin")) {
        throw new Error("Only site admins can add users");
      }
      if (role === "super_admin" && user.role !== "super_admin") {
        throw new Error("Only super admins can grant super admin role");
      }
      const normalisedEmail = email.trim().toLowerCase();
      const { error } = await supabase.from("site_users").insert({
        site_id: site.id,
        external_id: `pending:${normalisedEmail}`,
        email: normalisedEmail,
        display_name: displayName || null,
        role,
        active: true,
        preferences: {},
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site_users"] });
      setEmail("");
      setDisplayName("");
      setSearchInput("");
      setPickerOpen(false);
      setRole("member");
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add User</DialogTitle>
          <DialogDescription>
            Search the company directory or enter an email address manually.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Directory search */}
          <div className="space-y-2">
            <Label>Search Directory</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverAnchor asChild>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    ref={inputRef}
                    placeholder="Search by name or email..."
                    value={searchInput}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </PopoverAnchor>
              <PopoverContent
                className="w-[var(--radix-popover-trigger-width)] p-0"
                align="start"
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                {isSearching ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Searching...</span>
                  </div>
                ) : directoryUsers.length === 0 ? (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    No users found
                  </div>
                ) : (
                  <ul className="max-h-48 overflow-y-auto py-1">
                    {directoryUsers.map((dirUser) => {
                      const fullName =
                        dirUser.displayName ||
                        [dirUser.givenName, dirUser.surname].filter(Boolean).join(" ") ||
                        dirUser.userPrincipalName;
                      const email = dirUser.mail ?? dirUser.userPrincipalName;
                      const alias = dirUser.mailNickname;
                      return (
                        <li key={dirUser.id}>
                          <button
                            type="button"
                            className="flex w-full flex-col px-3 py-2 text-left hover:bg-accent"
                            onClick={() => handleSelectUser(dirUser)}
                          >
                            <span className="text-sm font-medium">{fullName}</span>
                            <span className="text-xs text-muted-foreground">{email}</span>
                            {alias && (
                              <span className="text-xs text-muted-foreground/70">
                                alias: {alias}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </PopoverContent>
            </Popover>
          </div>

          {/* Email (auto-filled from directory or manual entry) */}
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="user@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              placeholder="Jane Smith"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="site_admin">Site Admin</SelectItem>
                {user?.role === "super_admin" && (
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        {addUser.error && (
          <p className="text-sm text-destructive">
            {addUser.error.message}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => addUser.mutate()}
            disabled={!email.trim() || addUser.isPending || !user}
          >
            {addUser.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-2 h-4 w-4" />
            )}
            Add User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
