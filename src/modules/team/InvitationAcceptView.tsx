import React, { useState, useEffect, useCallback } from 'react';
import {
  Building,
  Shield,
  Mail,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  ArrowRight,
  UserCheck,
  RefreshCw,
  LogOut,
  Sparkles,
  Truck,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { teamService, normalizeEmail } from './teamService.ts';
import { TeamInvitation, UserRole } from '../../types/domain.types.ts';
import { StatusBadge } from '../../components/common/StatusBadge.tsx';
import { supabase, isSupabaseConfigured } from '../../lib/supabase.ts';

interface InvitationAcceptViewProps {
  rawToken: string;
  onAccepted?: (orgId: string) => void;
  onDismiss?: () => void;
}

export const InvitationAcceptView: React.FC<InvitationAcceptViewProps> = ({
  rawToken,
  onAccepted,
  onDismiss,
}) => {
  const { user, profile, refreshUserData, setActiveOrganizationId, signOut } = useAuth();

  const [invitation, setInvitation] = useState<TeamInvitation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Acceptance action states
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [acceptedSuccess, setAcceptedSuccess] = useState<boolean>(false);

  // Inline auth form states (if unauthenticated)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signup');
  const [authPassword, setAuthPassword] = useState('');
  const [authFullName, setAuthFullName] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadInvitation = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const inv = await teamService.getInvitationByToken(rawToken);
      if (!inv) {
        setFetchError('Invitation not found or the link has expired.');
      } else {
        setInvitation(inv);
      }
    } catch (err: any) {
      console.error('Error fetching invitation:', err);
      setFetchError(err.message || 'Unable to retrieve invitation details.');
    } finally {
      setIsLoading(false);
    }
  }, [rawToken]);

  useEffect(() => {
    loadInvitation();
  }, [loadInvitation]);

  const handleAccept = async () => {
    if (!invitation || !user || isAccepting || acceptedSuccess) return;
    setAcceptError(null);
    setIsAccepting(true);

    try {
      const res = await teamService.acceptInvitation(rawToken, {
        id: user.id,
        email: user.email || invitation.email,
        full_name: profile?.full_name || user.user_metadata?.full_name || 'Team Member',
      });

      await refreshUserData();
      setActiveOrganizationId(res.organizationId);
      setAcceptedSuccess(true);

      if (onAccepted) {
        setTimeout(() => onAccepted(res.organizationId), 1500);
      }
    } catch (err: any) {
      console.error('Error accepting invitation:', err?.message || 'Acceptance error');
      setAcceptError(err.message || 'Failed to accept invitation.');
    } finally {
      setIsAccepting(false);
    }
  };

  const handleInlineAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invitation || authLoading || acceptedSuccess) return;
    setAuthError(null);
    setAuthLoading(true);

    const targetEmail = invitation.email.trim();

    try {
      if (!isSupabaseConfigured) {
        // Demo / local mode automatic login as invited user
        const demoUser = {
          id: `usr-${Date.now()}`,
          email: targetEmail,
          full_name: authFullName || targetEmail.split('@')[0],
        };

        const res = await teamService.acceptInvitation(rawToken, demoUser);
        await refreshUserData();
        setAcceptedSuccess(true);
        if (onAccepted) {
          setTimeout(() => onAccepted(res.organizationId), 1500);
        }
        return;
      }

      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: targetEmail,
          password: authPassword.trim(),
          options: {
            data: {
              full_name: authFullName.trim() || targetEmail.split('@')[0],
            },
          },
        });
        if (error) throw error;

        if (data.user) {
          // Provision profile
          await supabase.from('profiles').upsert({
            id: data.user.id,
            full_name: authFullName.trim() || targetEmail.split('@')[0],
            preferred_timezone: 'America/Chicago',
          });

          // Auto-accept invitation with newly created account via secure RPC
          const res = await teamService.acceptInvitation(rawToken, {
            id: data.user.id,
            email: targetEmail,
            full_name: authFullName.trim(),
          });

          await refreshUserData();
          setActiveOrganizationId(res.organizationId);
          setAcceptedSuccess(true);

          if (onAccepted) {
            setTimeout(() => onAccepted(res.organizationId), 1500);
          }
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: targetEmail,
          password: authPassword.trim(),
        });
        if (error) throw error;

        if (data.user) {
          await refreshUserData();
          // Auto-accept after successful login via secure RPC
          const res = await teamService.acceptInvitation(rawToken, {
            id: data.user.id,
            email: data.user.email || targetEmail,
            full_name: data.user.user_metadata?.full_name,
          });

          await refreshUserData();
          setActiveOrganizationId(res.organizationId);
          setAcceptedSuccess(true);

          if (onAccepted) {
            setTimeout(() => onAccepted(res.organizationId), 1500);
          }
        }
      }
    } catch (err: any) {
      console.error('Auth error during invitation onboarding:', err?.message || 'Authentication error');
      setAuthError(err.message || 'Authentication failed. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const formatRoleTitle = (role?: UserRole): string => {
    switch (role) {
      case 'owner_admin':
        return 'Owner / Admin';
      case 'dispatcher':
        return 'Dispatcher';
      case 'staff':
        return 'Staff & Operations';
      case 'driver':
        return 'Driver';
      default:
        return role || 'Team Member';
    }
  };

  const isMatchingEmail =
    user?.email && invitation?.email
      ? normalizeEmail(user.email) === normalizeEmail(invitation.email)
      : false;

  const isExpiredOrInvalid =
    !invitation ||
    invitation.is_valid === false ||
    invitation.status === 'expired' ||
    invitation.status === 'cancelled' ||
    invitation.status === 'accepted';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 sm:p-6 text-slate-100">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800/90 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
        {/* Brand Header */}
        <div className="flex items-center justify-center gap-2.5 pb-4 border-b border-slate-800">
          <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-md">
            <Building className="w-6 h-6" />
          </div>
          <div>
            <span className="font-bold text-lg tracking-tight text-white block leading-none">
              DispatcherDesk
            </span>
            <span className="text-[11px] text-indigo-400 font-medium tracking-wide uppercase">
              Team Onboarding & Access
            </span>
          </div>
        </div>

        {/* Loading State */}
        {isLoading ? (
          <div className="py-12 text-center space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-400 mx-auto" />
            <p className="text-sm font-medium text-slate-300">
              Validating secure invitation token...
            </p>
          </div>
        ) : fetchError || !invitation ? (
          /* Error State */
          <div className="space-y-5 text-center py-4">
            <div className="w-12 h-12 rounded-full bg-rose-950/60 border border-rose-800/80 text-rose-400 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-bold text-slate-100">
                Invalid or Expired Invitation
              </h2>
              <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                {fetchError || 'This invitation link is no longer active. Please request a new invitation from your team administrator.'}
              </p>
            </div>
            <button
              id="btn-return-home-error"
              type="button"
              onClick={onDismiss}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition cursor-pointer"
            >
              Go to Workspace Home
            </button>
          </div>
        ) : acceptedSuccess ? (
          /* Accepted Success State */
          <div className="space-y-5 text-center py-4">
            <div className="w-14 h-14 rounded-full bg-emerald-950/60 border border-emerald-800/80 text-emerald-400 flex items-center justify-center mx-auto animate-bounce">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-emerald-300">
                {invitation.role === 'driver' ? 'Driver Identity Linked!' : "You're now a member!"}
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                {invitation.role === 'driver'
                  ? `Welcome to ${invitation.organization_name || 'the fleet'}. Your account has been securely linked to driver profile ${invitation.driver_name || 'Driver'}.`
                  : `Welcome to ${invitation.organization_name || 'the organization'}. Your account has been provisioned with the ${formatRoleTitle(invitation.role)} role.`}
              </p>
              {invitation.role === 'driver' && (
                <div className="mt-2 p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-emerald-200 text-xs">
                  Your persistent driver identity is now active. All future load dispatches assigned to you by your dispatcher will appear in your portal automatically without requiring new invites.
                </div>
              )}
            </div>
            <button
              id="btn-enter-workspace"
              type="button"
              onClick={onDismiss}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer shadow-lg shadow-indigo-600/30"
            >
              <span>{invitation.role === 'driver' ? 'Open Mobile Driver Portal' : 'Enter Organization Workspace'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : isExpiredOrInvalid ? (
          /* Status Check Alert (Cancelled / Expired / Already Accepted) */
          <div className="space-y-5 text-center py-4">
            <div className="w-12 h-12 rounded-full bg-amber-950/60 border border-amber-800/80 text-amber-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-bold text-slate-100">
                Invitation {invitation.status.toUpperCase()}
              </h2>
              <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                {invitation.invalid_reason ||
                  (invitation.status === 'cancelled' &&
                    'This invitation was cancelled by an organization administrator.') ||
                  (invitation.status === 'accepted' &&
                    'This invitation has already been accepted and cannot be reused.') ||
                  (invitation.status === 'expired' &&
                    'This invitation has expired. Invitations are valid for 7 days.') ||
                  'This invitation is no longer valid.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              className="px-5 py-2.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition cursor-pointer"
            >
              Return to Home
            </button>
          </div>
        ) : invitation.role === 'driver' ? (
          /* Driver Migration Notice for Legacy Invitations */
          <div className="space-y-6">
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-6 space-y-4 text-center">
              <div className="w-14 h-14 rounded-full bg-indigo-950/60 border border-indigo-800/80 text-indigo-400 flex items-center justify-center mx-auto shadow-inner">
                <Truck className="w-7 h-7" />
              </div>

              <div className="space-y-2">
                <h2 className="text-base font-bold text-slate-100">
                  Driver Portal Authentication has migrated to Phone OTP.
                </h2>
                <p className="text-xs text-slate-300 max-w-sm mx-auto leading-relaxed">
                  Please log in using your registered mobile phone number.
                </p>
              </div>

              <div className="divide-y divide-slate-800/70 text-xs text-left bg-slate-900/60 rounded-lg p-3.5 border border-slate-800">
                <div className="py-1.5 flex items-center justify-between">
                  <span className="text-slate-400">Organization:</span>
                  <span className="font-semibold text-slate-200">{invitation.organization_name || 'Fleet Organization'}</span>
                </div>
                {invitation.driver_name && (
                  <div className="py-1.5 flex items-center justify-between">
                    <span className="text-slate-400">Driver Profile:</span>
                    <span className="font-semibold text-slate-200">{invitation.driver_name}</span>
                  </div>
                )}
                <div className="py-1.5 flex items-center justify-between">
                  <span className="text-slate-400">Invited Email:</span>
                  <span className="font-mono text-slate-300">{invitation.email}</span>
                </div>
              </div>

              <div className="pt-2">
                <a
                  id="btn-driver-portal-login"
                  href="/driver/login"
                  className="inline-flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition shadow-lg shadow-indigo-600/30 cursor-pointer"
                >
                  <span>Go to Driver Portal Login</span>
                  <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </div>

            <div className="text-center">
              <button
                type="button"
                onClick={onDismiss}
                className="text-xs text-slate-400 hover:text-slate-300 transition cursor-pointer"
              >
                Return to Home
              </button>
            </div>
          </div>
        ) : (
          /* Valid Active Invitation Flow */
          <div className="space-y-6">
            {/* Invitation Summary Card */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3.5">
              <div className="text-center space-y-1">
                <span className="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider">
                  Organization Invitation
                </span>
                <h1 className="text-base font-bold text-white">
                  Join {invitation.organization_name || 'Fleet Organization'}
                </h1>
              </div>

              <div className="divide-y divide-slate-800/70 text-xs">
                <div className="py-2 flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-indigo-400" />
                    Assigned Role:
                  </span>
                  <StatusBadge status={invitation.role} type="role" size="sm" />
                </div>
                <div className="py-2 flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    Invited Email:
                  </span>
                  <span className="font-mono text-slate-200 font-medium">
                    {invitation.email}
                  </span>
                </div>
                <div className="py-2 flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    Expires:
                  </span>
                  <span className="text-slate-300 text-[11px]">
                    {new Date(invitation.expires_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </div>
            </div>

            {/* Error banners */}
            {acceptError && (
              <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 space-y-2">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{acceptError}</span>
                </div>
                {acceptError.toLowerCase().includes('already a member') && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={onDismiss}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer shadow-sm"
                    >
                      <span>Enter Organization Workspace</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Branch 1: User is Authenticated */}
            {user ? (
              isMatchingEmail ? (
                /* Authenticated with MATCHING email -> Direct Acceptance */
                <div className="space-y-4">
                  <div className="p-3.5 rounded-lg bg-indigo-950/40 border border-indigo-800/60 text-xs text-indigo-200 flex items-start gap-2.5">
                    <UserCheck className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      Signed in as <strong className="text-white">{user.email}</strong>. Click below to accept the invitation and link your account.
                    </div>
                  </div>

                  <button
                    id="btn-accept-invitation"
                    type="button"
                    onClick={handleAccept}
                    disabled={isAccepting}
                    className="w-full py-3 px-4 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isAccepting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Joining Organization...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Accept Invitation & Join Organization
                      </>
                    )}
                  </button>
                </div>
              ) : (
                /* Authenticated with DIFFERENT email -> Mismatch Warning */
                <div className="space-y-4 text-xs">
                  <div className="p-4 rounded-lg bg-amber-950/50 border border-amber-800/70 text-amber-200 space-y-2">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-amber-100">
                          Account Email Mismatch
                        </p>
                        <p className="text-amber-300/90 mt-1 leading-relaxed">
                          This invitation was sent to <strong className="text-white font-mono">{invitation.email}</strong>.
                          You are currently signed in as <strong className="text-white font-mono">{user.email}</strong>.
                        </p>
                      </div>
                    </div>
                    <p className="text-[11px] text-amber-400/90 pt-1">
                      To accept this invitation, please switch accounts and sign in with the invited email address.
                    </p>
                  </div>

                  <button
                    id="btn-switch-account-invitation"
                    type="button"
                    onClick={signOut}
                    className="w-full py-2.5 px-4 rounded-lg text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out & Switch Account
                  </button>
                </div>
              )
            ) : (
              /* Branch 2: User is Unauthenticated -> Direct In-line Auth */
              <div className="space-y-4">
                {/* Auth Mode Toggle */}
                <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setAuthMode('signup')}
                    className={`flex-1 py-1.5 rounded-md transition ${
                      authMode === 'signup'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Create New Account
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMode('signin')}
                    className={`flex-1 py-1.5 rounded-md transition ${
                      authMode === 'signin'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Sign In to Existing Account
                  </button>
                </div>

                {authError && (
                  <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{authError}</span>
                  </div>
                )}

                <form onSubmit={handleInlineAuth} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Invited Email Address
                    </label>
                    <input
                      type="email"
                      readOnly
                      disabled
                      value={invitation.email}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-400 font-mono text-xs cursor-not-allowed"
                    />
                  </div>

                  {authMode === 'signup' && (
                    <div>
                      <label className="block text-slate-300 font-medium mb-1">
                        Your Full Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Marcus Vance"
                        value={authFullName}
                        onChange={(e) => setAuthFullName(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 transition"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      {authMode === 'signup' ? 'Create Password *' : 'Account Password *'}
                    </label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 transition"
                    />
                  </div>

                  <button
                    id="btn-submit-invitation-auth"
                    type="submit"
                    disabled={authLoading}
                    className="w-full py-3 px-4 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {authLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        {authMode === 'signup' ? 'Creating Account & Joining...' : 'Authenticating & Joining...'}
                      </>
                    ) : (
                      <>
                        <UserCheck className="w-4 h-4" />
                        {authMode === 'signup'
                          ? 'Create Account & Join Organization'
                          : 'Sign In & Accept Invitation'}
                      </>
                    )}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
