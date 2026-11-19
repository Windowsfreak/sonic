package tlsfetch

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestExecuteBatchCookiesAndHeaders(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie("cf_clearance")
		if err != nil || c.Value != "test_clear" {
			http.Error(w, "missing cookie", http.StatusForbidden)
			return
		}
		if r.Header.Get("User-Agent") != "TestAgent/1.0" {
			http.Error(w, "bad ua", http.StatusBadRequest)
			return
		}
		if r.Method == http.MethodPost {
			body, _ := io.ReadAll(r.Body)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"body":"` + string(body) + `"}`))
			return
		}
		_, _ = w.Write([]byte("hello-get"))
	}))
	defer srv.Close()

	res, err := ExecuteBatch(context.Background(), BatchRequest{
		UserAgent: "TestAgent/1.0",
		BaseURL:   srv.URL,
		Profile:   "firefox",
		Cookies: []CookieInput{
			{Name: "cf_clearance", Value: "test_clear", Path: "/"},
		},
		Requests: []RequestSpec{
			{Method: "POST", URL: srv.URL + "/charts", Body: "a=1"},
			{Method: "GET", URL: srv.URL + "/page2"},
		},
	})
	if err != nil {
		t.Fatalf("ExecuteBatch failed: %v", err)
	}
	if len(res.Responses) != 2 {
		t.Fatalf("expected 2 responses, got %d", len(res.Responses))
	}
	if res.Responses[0].Status != 200 || res.Responses[0].Body != `{"ok":true,"body":"a=1"}` {
		t.Fatalf("unexpected resp[0]: %+v", res.Responses[0])
	}
	if res.Responses[1].Status != 200 || res.Responses[1].Body != "hello-get" {
		t.Fatalf("unexpected resp[1]: %+v", res.Responses[1])
	}
}
