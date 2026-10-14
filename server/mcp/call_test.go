package mcp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

func TestToolsListRequiresInitializedSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	srv := newTestServer(map[string]*session{
		"s1": {id: "s1", userID: 1},
	})

	r := gin.New()
	r.POST("/mcp", func(c *gin.Context) {
		common.GinAppendValues(c, conf.UserKey, &model.User{ID: 1, Role: model.ADMIN})
		srv.handlePost(c)
	})

	req := httptest.NewRequest(http.MethodPost, "http://example.com/mcp", strings.NewReader(`{
		"jsonrpc":"2.0",
		"id":1,
		"method":"tools/list"
	}`))
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Origin", "http://example.com")
	req.Header.Set(ProtocolVersionHeader, ProtocolVersion)
	req.Header.Set(SessionHeader, "s1")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status: got %d want %d", w.Code, http.StatusBadRequest)
	}
	resp := decodeResponse(t, w)
	if resp.Error == nil || resp.Error.Code != -32002 {
		t.Fatalf("unexpected error response: %+v", resp.Error)
	}
}

func TestToolsListSuccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	srv := newTestServer(map[string]*session{
		"s2": {id: "s2", userID: 1, initialized: true},
	})

	r := gin.New()
	r.POST("/mcp", func(c *gin.Context) {
		common.GinAppendValues(c, conf.UserKey, &model.User{ID: 1, Role: model.ADMIN})
		srv.handlePost(c)
	})

	req := httptest.NewRequest(http.MethodPost, "http://example.com/mcp", strings.NewReader(`{
		"jsonrpc":"2.0",
		"id":2,
		"method":"tools/list"
	}`))
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Origin", "http://example.com")
	req.Header.Set(ProtocolVersionHeader, ProtocolVersion)
	req.Header.Set(SessionHeader, "s2")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", w.Code, http.StatusOK)
	}
	resp := decodeResponse(t, w)
	if resp.Error != nil {
		t.Fatalf("unexpected error response: %+v", resp.Error)
	}

	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("unexpected result type: %T", resp.Result)
	}
	tools, ok := result["tools"].([]any)
	if !ok || len(tools) != 3 {
		t.Fatalf("unexpected tools payload: %#v", result["tools"])
	}
	names := map[string]bool{}
	for _, rawTool := range tools {
		currentTool, ok := rawTool.(map[string]any)
		if !ok {
			t.Fatalf("unexpected tool payload: %#v", rawTool)
		}
		name, _ := currentTool["name"].(string)
		names[name] = true
	}
	if !names["openbox.fs.list"] || !names["openbox.fs.get"] || !names["openbox.fs.link"] {
		t.Fatalf("unexpected tool names: %#v", names)
	}
}

func TestToolsCallUnknownTool(t *testing.T) {
	gin.SetMode(gin.TestMode)
	srv := newTestServer(map[string]*session{
		"s3": {id: "s3", userID: 1, initialized: true},
	})

	r := gin.New()
	r.POST("/mcp", func(c *gin.Context) {
		common.GinAppendValues(c, conf.UserKey, &model.User{ID: 1, Role: model.ADMIN})
		srv.handlePost(c)
	})

	req := httptest.NewRequest(http.MethodPost, "http://example.com/mcp", strings.NewReader(`{
		"jsonrpc":"2.0",
		"id":3,
		"method":"tools/call",
		"params":{"name":"openbox.fs.unknown","arguments":{"path":"/"}}
	}`))
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Origin", "http://example.com")
	req.Header.Set(ProtocolVersionHeader, ProtocolVersion)
	req.Header.Set(SessionHeader, "s3")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", w.Code, http.StatusOK)
	}
	resp := decodeResponse(t, w)
	if resp.Error == nil || resp.Error.Code != -32601 {
		t.Fatalf("unexpected error response: %+v", resp.Error)
	}
}

func TestToolsCallInvalidParams(t *testing.T) {
	gin.SetMode(gin.TestMode)
	srv := newTestServer(map[string]*session{
		"s4": {id: "s4", userID: 1, initialized: true},
	})

	r := gin.New()
	r.POST("/mcp", func(c *gin.Context) {
		common.GinAppendValues(c, conf.UserKey, &model.User{ID: 1, Role: model.ADMIN})
		srv.handlePost(c)
	})

	req := httptest.NewRequest(http.MethodPost, "http://example.com/mcp", strings.NewReader(`{
		"jsonrpc":"2.0",
		"id":4,
		"method":"tools/call",
		"params":{"name":"openbox.fs.list","arguments":"bad"}
	}`))
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Origin", "http://example.com")
	req.Header.Set(ProtocolVersionHeader, ProtocolVersion)
	req.Header.Set(SessionHeader, "s4")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", w.Code, http.StatusOK)
	}
	resp := decodeResponse(t, w)
	if resp.Error != nil {
		t.Fatalf("expected tool error result, got protocol error: %+v", resp.Error)
	}
}

func TestBrandedAndLegacyToolsUseSameValidationAndSessionGate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	srv := newTestServer(map[string]*session{
		"brand-session": {id: "brand-session", userID: 1, initialized: true},
	})
	r := gin.New()
	r.POST("/mcp", func(c *gin.Context) {
		common.GinAppendValues(c, conf.UserKey, &model.User{ID: 1, Role: model.ADMIN})
		srv.handlePost(c)
	})
	for _, operation := range []string{"list", "get", "link"} {
		for _, prefix := range []string{"openbox", "openlist"} {
			for _, initialized := range []bool{false, true} {
				name := prefix + ".fs." + operation
				body, err := json.Marshal(map[string]any{
					"jsonrpc": "2.0", "id": 1, "method": "tools/call",
					"params": map[string]any{"name": name, "arguments": "bad"},
				})
				if err != nil {
					t.Fatal(err)
				}
				req := httptest.NewRequest(http.MethodPost, "http://example.com/mcp", strings.NewReader(string(body)))
				req.Header.Set("Accept", "application/json, text/event-stream")
				req.Header.Set("Origin", "http://example.com")
				req.Header.Set(ProtocolVersionHeader, ProtocolVersion)
				if initialized {
					req.Header.Set(SessionHeader, "brand-session")
				}
				w := httptest.NewRecorder()
				r.ServeHTTP(w, req)
				resp := decodeResponse(t, w)
				if !initialized {
					if w.Code != http.StatusBadRequest || resp.Error == nil {
						t.Fatalf("%s bypassed session gate: %d %+v", name, w.Code, resp)
					}
					continue
				}
				if w.Code != http.StatusOK || resp.Error != nil {
					t.Fatalf("%s did not reach shared handler: %d %+v", name, w.Code, resp)
				}
				result := resp.Result.(map[string]any)
				if result["isError"] != true {
					t.Fatalf("%s accepted invalid arguments", name)
				}
				content := result["content"].([]any)[0].(map[string]any)
				if content["text"] != "invalid openbox.fs."+operation+" arguments" {
					t.Fatalf("%s returned unexpected validation: %v", name, content)
				}
			}
		}
	}
}

func decodeResponse(t *testing.T, w *httptest.ResponseRecorder) response {
	t.Helper()

	var resp response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	return resp
}
