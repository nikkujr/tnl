import { Component, DestroyRef, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BusinessApi } from '../../core/business-api.service';
import { SessionService } from '../../core/session.service';
import { SessionUser } from '../../core/api.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { AppIconComponent } from '../../shared/app-icon.component';

interface AccountProfile {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  address: string | null;
  role: SessionUser['role'];
}
interface AccountUpdate {
  profile: AccountProfile;
  user: SessionUser;
  token: string;
}
@Component({
  selector: 'app-account-page',
  imports: [FormsModule, RouterLink, BreadcrumbComponent, AppIconComponent],
  templateUrl: './account.page.html',
  styleUrl: './account.page.scss',
})
export class AccountPage implements OnInit, OnDestroy {
  private readonly api = inject(BusinessApi);
  private readonly sessionService = inject(SessionService);
  private readonly destroyRef = inject(DestroyRef);
  readonly session = this.sessionService.session;
  readonly profile = signal<AccountProfile | null>(null);
  readonly loading = signal(true);
  readonly saving = signal<'profile' | 'password' | null>(null);
  readonly loadError = signal('');
  readonly profileError = signal('');
  readonly profileNotice = signal('');
  readonly passwordError = signal('');
  readonly passwordNotice = signal('');
  readonly showPassword = signal(false);
  readonly initials = computed(
    () =>
      this.profile()
        ?.fullName.split(' ')
        .filter(Boolean)
        .map((v) => v[0])
        .slice(0, 2)
        .join('') ?? '',
  );
  fullName = '';
  phone = '';
  address = '';
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  ngOnInit() {
    this.load();
  }
  load() {
    this.loading.set(true);
    this.loadError.set('');
    this.api
      .get<AccountProfile>('account')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.applyProfile(data);
          this.loading.set(false);
        },
        error: (e) => {
          this.loadError.set(e.error?.error?.message ?? 'Unable to load your account.');
          this.loading.set(false);
        },
      });
  }
  private applyProfile(data: AccountProfile) {
    this.profile.set(data);
    this.fullName = data.fullName;
    this.phone = data.phone ?? '';
    this.address = data.address ?? '';
  }
  saveProfile() {
    if (this.saving() || !this.profile()) return;
    this.saving.set('profile');
    this.profileError.set('');
    this.profileNotice.set('');
    const body = {
      fullName: this.fullName.trim(),
      phone: this.phone.trim() || null,
      ...(this.profile()!.role === 'CUSTOMER' ? { address: this.address.trim() } : {}),
    };
    this.api
      .patch<AccountUpdate>('account/profile', body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.sessionService.setSession(data);
          this.applyProfile(data.profile);
          this.saving.set(null);
          this.profileNotice.set('Your profile has been updated.');
        },
        error: (e) => {
          this.saving.set(null);
          this.profileError.set(e.error?.error?.message ?? 'Unable to save your profile.');
        },
      });
  }
  changePassword() {
    if (this.saving()) return;
    this.passwordError.set('');
    this.passwordNotice.set('');
    if (this.newPassword !== this.confirmPassword) {
      this.passwordError.set('New passwords do not match.');
      return;
    }
    if (new TextEncoder().encode(this.newPassword).length > 72) {
      this.passwordError.set('Use a password within 72 UTF-8 bytes.');
      return;
    }
    this.saving.set('password');
    this.api
      .patch<AccountUpdate>('account/password', {
        currentPassword: this.currentPassword,
        newPassword: this.newPassword,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.sessionService.setSession(data);
          this.clearPasswords();
          this.saving.set(null);
          this.passwordNotice.set('Password changed. Other sessions have been signed out.');
        },
        error: (e) => {
          this.saving.set(null);
          this.currentPassword = '';
          this.passwordError.set(e.error?.error?.message ?? 'Unable to change your password.');
        },
      });
  }
  private clearPasswords() {
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmPassword = '';
    this.showPassword.set(false);
  }
  ngOnDestroy() {
    this.clearPasswords();
  }
}
