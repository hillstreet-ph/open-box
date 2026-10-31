package model

import (
	"strings"
	"testing"
	"time"
)

// guardTimings shortens the counting window and the lock so a policy test runs
// in milliseconds, and restores the production values afterwards. Each test uses
// its own client address so the shared LoginCache cannot leak state between them.
func guardTimings(t *testing.T, ip string, window, lock time.Duration) {
	t.Helper()
	oldWindow, oldLock := DefaultAttemptWindow, DefaultLockDuration
	DefaultAttemptWindow, DefaultLockDuration = window, lock
	t.Cleanup(func() {
		DefaultAttemptWindow, DefaultLockDuration = oldWindow, oldLock
		ClearLoginAttempts(ip)
	})
	ClearLoginAttempts(ip)
}

func TestAttemptWindowDecays(t *testing.T) {
	const ip = "203.0.113.10"
	guardTimings(t, ip, 80*time.Millisecond, time.Minute)

	for i := 0; i < DefaultMaxAuthRetries-2; i++ {
		RecordLoginFailure(ip)
	}
	if got := LoginFailures(ip); got != DefaultMaxAuthRetries-2 {
		t.Fatalf("LoginFailures = %d, want %d", got, DefaultMaxAuthRetries-2)
	}
	if _, locked := LoginLocked(ip); locked {
		t.Fatal("locked before the limit was reached")
	}

	// A counter written without a TTL outlives every window: these mistakes used
	// to be permanent and added up across days.
	time.Sleep(150 * time.Millisecond)
	if got := LoginFailures(ip); got != 0 {
		t.Fatalf("LoginFailures after the window = %d, want 0 (the count must decay)", got)
	}
}

func TestLockIsNotExtendedByRetries(t *testing.T) {
	const ip = "203.0.113.11"
	guardTimings(t, ip, time.Minute, 250*time.Millisecond)

	for i := 0; i < DefaultMaxAuthRetries; i++ {
		RecordLoginFailure(ip)
	}
	remaining, locked := LoginLocked(ip)
	if !locked {
		t.Fatal("not locked after reaching the attempt limit")
	}
	if remaining <= 0 || remaining > DefaultLockDuration {
		t.Fatalf("lock remaining = %s, want 0 < remaining <= %s", remaining, DefaultLockDuration)
	}
	if got := LoginFailures(ip); got != 0 {
		t.Fatalf("the counting window survived the lock: LoginFailures = %d", got)
	}

	// Every retry used to re-arm a fresh deadline, so a client that retried more
	// often than the lock lasted was never released.
	first := remaining
	time.Sleep(60 * time.Millisecond)
	RecordLoginFailure(ip)
	RecordLoginFailure(ip)
	again, locked := LoginLocked(ip)
	if !locked {
		t.Fatal("a retry while locked released the client")
	}
	if again > first {
		t.Fatalf("retries extended the lock: %s -> %s", first, again)
	}

	time.Sleep(250 * time.Millisecond)
	if _, locked := LoginLocked(ip); locked {
		t.Fatal("still locked after the lock duration, even though the retries were part of the lock")
	}
	// The client starts from zero, rather than resuming a half-used window.
	if got := LoginFailures(ip); got != 0 {
		t.Fatalf("LoginFailures after the lock lifted = %d, want 0", got)
	}
}

func TestSuccessfulSignInClearsTheGuard(t *testing.T) {
	const ip = "203.0.113.12"
	guardTimings(t, ip, time.Hour, time.Hour)

	for i := 0; i < DefaultMaxAuthRetries-1; i++ {
		RecordLoginFailure(ip)
	}
	if got := LoginFailures(ip); got != DefaultMaxAuthRetries-1 {
		t.Fatalf("LoginFailures = %d, want %d", got, DefaultMaxAuthRetries-1)
	}
	ClearLoginAttempts(ip)
	if got := LoginFailures(ip); got != 0 {
		t.Fatalf("LoginFailures after a successful sign-in = %d, want 0", got)
	}
	if _, locked := LoginLocked(ip); locked {
		t.Fatal("a successful sign-in left the client locked")
	}
}

func TestTooManyAttemptsMessageStatesTheWait(t *testing.T) {
	msg := TooManyAttemptsMessage(4*time.Minute + 12*time.Second)
	if !strings.Contains(msg, TooManyAttempts) {
		t.Fatalf("message dropped the standard text: %q", msg)
	}
	if !strings.Contains(msg, "4m12s") {
		t.Fatalf("message does not carry the time left: %q", msg)
	}
}

func TestLoginKeyFromAddr(t *testing.T) {
	tests := []struct{ addr, want string }{
		{"203.0.113.9:54321", "203.0.113.9"},
		{"[2001:db8::1]:22", "2001:db8::1"},
		{"203.0.113.9", "203.0.113.9"},
		{"", ""},
	}
	for _, tt := range tests {
		if got := LoginKeyFromAddr(tt.addr); got != tt.want {
			t.Errorf("LoginKeyFromAddr(%q) = %q, want %q", tt.addr, got, tt.want)
		}
	}
}
