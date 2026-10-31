package handles

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils/random"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func init() {
	conf.Conf = conf.DefaultConfig("data")
	dB, err := gorm.Open(sqlite.Open("file::memory:?cache=shared&mode=memory"), &gorm.Config{})
	if err != nil {
		panic("failed to connect database for the login guard tests")
	}
	db.Init(dB)
}

const (
	guardUser     = "login-guard-user"
	guardPassword = "the-right-password"
)

// loginOutcome is the API envelope of a sign-in attempt. OpenList answers
// failures with HTTP 200 and carries the status inside the JSON body, so the
// logical code is what has to be asserted — checking w.Code would pass for every
// response, locked out or not.
type loginOutcome struct {
	code    int
	message string
	token   string
}

func loginAs(t *testing.T, ip, password string) loginOutcome {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/auth/login/hash", LoginHash)
	w := httptest.NewRecorder()
	body := `{"username":"` + guardUser + `","password":"` + password + `","otp_code":""}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login/hash", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = ip + ":54321"
	r.ServeHTTP(w, req)
	var env struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("http %d is not an API envelope: %q", w.Code, strings.TrimSpace(w.Body.String()))
	}
	return loginOutcome{code: env.Code, message: env.Message, token: env.Data.Token}
}

// setupGuardUser creates a user with a known password and shortens the guard
// timings so the window and the lock can be observed inside a test.
func setupGuardUser(t *testing.T, ip string, window, lock time.Duration) {
	t.Helper()
	oldWindow, oldLock := model.DefaultAttemptWindow, model.DefaultLockDuration
	model.DefaultAttemptWindow, model.DefaultLockDuration = window, lock
	t.Cleanup(func() {
		model.DefaultAttemptWindow, model.DefaultLockDuration = oldWindow, oldLock
		model.ClearLoginAttempts(ip)
	})
	model.ClearLoginAttempts(ip)
	if _, err := op.GetUserByName(guardUser); err != nil {
		salt := random.String(16)
		if err := op.CreateUser(&model.User{
			Username:   guardUser,
			Salt:       salt,
			PwdHash:    model.TwoHashPwd(guardPassword, salt),
			Role:       model.GENERAL,
			BasePath:   "/",
			Authn:      "[]",
			Permission: 0x71FF,
		}); err != nil {
			t.Fatalf("create %s: %v", guardUser, err)
		}
	}
}

const (
	guardIP   = "198.51.100.7"
	anotherIP = "198.51.100.8"
)

func staticHash(pwd string) string {
	return model.StaticHash(pwd)
}

func TestSignInLockoutLiftsEvenWhileTheClientRetries(t *testing.T) {
	setupGuardUser(t, guardIP, time.Minute, 300*time.Millisecond)

	for i := 0; i < model.DefaultMaxAuthRetries; i++ {
		got := loginAs(t, guardIP, staticHash("not-the-password"))
		if got.code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: code = %d (%s), want 401", i+1, got.code, got.message)
		}
	}

	locked := loginAs(t, guardIP, staticHash("not-the-password"))
	if locked.code != http.StatusTooManyRequests {
		t.Fatalf("after the limit: code = %d (%s), want 429", locked.code, locked.message)
	}
	if !strings.Contains(locked.message, "Attempts unlock in") {
		t.Fatalf("the rejection does not say how long to wait: %q", locked.message)
	}
	deadline, _ := model.LoginLocked(guardIP)
	if deadline <= 0 {
		t.Fatalf("the lock reports no remaining time: %s", deadline)
	}

	// Retrying inside the lock used to re-arm a fresh deadline, so "try again
	// later" never became true for anyone who kept trying — which is exactly what
	// a person who has mistyped a password does. The deadline has to run down
	// instead of restarting, and the client has to be released at the first one.
	for i := 1; i <= 3; i++ {
		got := loginAs(t, guardIP, staticHash("not-the-password"))
		if got.code != http.StatusTooManyRequests {
			t.Fatalf("retry %d: code = %d (%s), want 429", i, got.code, got.message)
		}
		remaining, isLocked := model.LoginLocked(guardIP)
		if !isLocked {
			t.Fatalf("retry %d released the client early", i)
		}
		if remaining >= deadline {
			t.Fatalf("retry %d extended the lock: %s -> %s", i, deadline, remaining)
		}
	}

	time.Sleep(deadline)
	fresh := loginAs(t, guardIP, staticHash("not-the-password"))
	if fresh.code != http.StatusUnauthorized {
		t.Fatalf("after the deadline: code = %d (%s), want a fresh 401 window", fresh.code, fresh.message)
	}
}

func TestSuccessfulSignInForgetsTheFailures(t *testing.T) {
	setupGuardUser(t, anotherIP, time.Minute, time.Minute)

	for i := 0; i < model.DefaultMaxAuthRetries-1; i++ {
		if got := loginAs(t, anotherIP, staticHash("not-the-password")); got.code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: code = %d (%s), want 401", i+1, got.code, got.message)
		}
	}
	ok := loginAs(t, anotherIP, staticHash(guardPassword))
	if ok.code != 200 || ok.token == "" {
		t.Fatalf("correct password rejected: code = %d (%s)", ok.code, ok.message)
	}
	if got := model.LoginFailures(anotherIP); got != 0 {
		t.Fatalf("failures survived a successful sign-in: %d", got)
	}
	// With a clean slate the client gets the whole window back rather than being
	// one typo away from a lock.
	for i := 0; i < model.DefaultMaxAuthRetries; i++ {
		if got := loginAs(t, anotherIP, staticHash("not-the-password")); got.code != http.StatusUnauthorized {
			t.Fatalf("post-success attempt %d: code = %d (%s), want 401", i+1, got.code, got.message)
		}
	}
	if got := loginAs(t, anotherIP, staticHash("not-the-password")); got.code != http.StatusTooManyRequests {
		t.Fatalf("the guard stopped counting: code = %d (%s), want 429", got.code, got.message)
	}
}
