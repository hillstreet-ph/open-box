package model

import (
	"fmt"
	"net"
	"time"

	"github.com/OpenListTeam/go-cache"
)

// Sign-in attempts are counted per client address so that guessing a password
// is not unlimited. LoginCache holds those counts, and go-cache entries only
// expire when a TTL is supplied, so the whole policy lives here: writing a
// count without a TTL keeps it for the lifetime of the process, and refreshing
// a deadline on every rejected attempt means a client that retries more often
// than the nominal lock is never released.
//
// The policy these helpers implement:
//
//   - each failure counts for DefaultAttemptWindow, and the window restarts on
//     every failure, so old mistakes stop working against a client;
//   - reaching DefaultMaxAuthRetries replaces the window with a lock of
//     DefaultLockDuration whose deadline is fixed when the lock starts;
//   - retries while locked report the time left and never extend it;
//   - a successful sign-in, or an explicit logout, forgets everything.
var (
	LoginCache = cache.NewMemCache[int]()

	// DefaultAttemptWindow is how long a failed attempt keeps counting.
	DefaultAttemptWindow = time.Minute * 10
	// DefaultLockDuration is how long a client stays locked once it has used up
	// its attempts.
	DefaultLockDuration = time.Minute * 5
	// DefaultMaxAuthRetries is the number of failures allowed per window.
	DefaultMaxAuthRetries = 5
)

// loginLockPrefix keeps the lock entry apart from the counting entry, which are
// both keyed by the same client address.
const loginLockPrefix = "login-lock:"

func loginLockKey(ip string) string {
	return loginLockPrefix + ip
}

// LoginKeyFromAddr turns a peer address such as "203.0.113.9:54321" into the
// address the guard counts against. The protocol servers see one ephemeral port
// per connection, so using the full address would give every attempt its own
// counter and let a guesser run unlimited tries.
func LoginKeyFromAddr(addr string) string {
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
}

// LoginFailures returns how many failed sign-ins are currently counted for ip.
func LoginFailures(ip string) int {
	count, _ := LoginCache.Get(ip)
	return count
}

// LoginLocked reports whether ip has used up its attempts and how long that
// state lasts. Only the attempt that reached the limit sets the deadline, so a
// client that keeps retrying is still released at the original time.
func LoginLocked(ip string) (time.Duration, bool) {
	remaining, ok := LoginCache.Ttl(loginLockKey(ip))
	if !ok || remaining <= 0 {
		return 0, false
	}
	return remaining, true
}

// RecordLoginFailure counts one failed sign-in for ip. It does nothing while ip
// is already locked, because the lock would otherwise be extended by retries.
func RecordLoginFailure(ip string) {
	if _, locked := LoginLocked(ip); locked {
		return
	}
	count := LoginFailures(ip) + 1
	if count >= DefaultMaxAuthRetries {
		// Drop the counter when the lock starts, so the client begins from zero
		// once the lock lifts instead of resuming a half-used window.
		LoginCache.Del(ip)
		LoginCache.Set(loginLockKey(ip), count, cache.WithEx[int](DefaultLockDuration))
		return
	}
	LoginCache.Set(ip, count, cache.WithEx[int](DefaultAttemptWindow))
}

// ClearLoginAttempts forgets every failure and lock recorded for ip. Call it
// after a successful sign-in.
func ClearLoginAttempts(ip string) {
	LoginCache.Del(ip, loginLockKey(ip))
}

// TooManyAttemptsMessage renders the standard rejection with the time the client
// still has to wait, so a locked-out operator knows whether to wait or to look
// for another cause.
func TooManyAttemptsMessage(remaining time.Duration) string {
	return fmt.Sprintf("%s Attempts unlock in %s.", TooManyAttempts, remaining.Truncate(time.Second))
}
