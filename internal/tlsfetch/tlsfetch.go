package tlsfetch

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"

	fhttp "github.com/bogdanfinn/fhttp"
	tls_client "github.com/bogdanfinn/tls-client"
	"github.com/bogdanfinn/tls-client/profiles"
)

// CookieInput represents a browser cookie exported from Byparr/Camoufox.
type CookieInput struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Domain   string `json:"domain,omitempty"`
	Path     string `json:"path,omitempty"`
	Secure   bool   `json:"secure,omitempty"`
	HttpOnly bool   `json:"httpOnly,omitempty"`
}

// RequestSpec defines a single HTTP request to execute inside the TLS session.
type RequestSpec struct {
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers,omitempty"`
	Body    string            `json:"body,omitempty"`
}

// BatchRequest executes one or more HTTP requests sharing cookies and a browser TLS fingerprint.
type BatchRequest struct {
	UserAgent string        `json:"userAgent"`
	BaseURL   string        `json:"baseUrl"`
	Profile   string        `json:"profile,omitempty"`
	Cookies   []CookieInput `json:"cookies,omitempty"`
	Requests  []RequestSpec `json:"requests"`
}

// ResponseItem holds the outcome of a single RequestSpec.
type ResponseItem struct {
	Status int    `json:"status"`
	Body   string `json:"body"`
	Error  string `json:"error,omitempty"`
}

// BatchResponse returns responses aligned by index with BatchRequest.Requests.
type BatchResponse struct {
	Responses []ResponseItem `json:"responses"`
}

func selectProfile(name string) profiles.ClientProfile {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "chrome":
		return profiles.Chrome_133
	case "firefox", "":
		return profiles.Firefox_148
	default:
		return profiles.Firefox_148
	}
}

// ExecuteBatch runs all requests in req using bogdanfinn/tls-client and a shared cookie jar.
func ExecuteBatch(ctx context.Context, req BatchRequest) (*BatchResponse, error) {
	jar := tls_client.NewCookieJar()
	if req.BaseURL != "" && len(req.Cookies) > 0 {
		baseU, err := url.Parse(req.BaseURL)
		if err != nil {
			return nil, fmt.Errorf("invalid baseUrl: %w", err)
		}
		cookies := make([]*fhttp.Cookie, 0, len(req.Cookies))
		for _, c := range req.Cookies {
			if c.Name == "" {
				continue
			}
			p := c.Path
			if p == "" {
				p = "/"
			}
			cookies = append(cookies, &fhttp.Cookie{
				Name:     c.Name,
				Value:    c.Value,
				Domain:   c.Domain,
				Path:     p,
				Secure:   c.Secure,
				HttpOnly: c.HttpOnly,
			})
		}
		jar.SetCookies(baseU, cookies)
	}

	client, err := tls_client.NewHttpClient(
		tls_client.NewNoopLogger(),
		tls_client.WithTimeoutSeconds(30),
		tls_client.WithClientProfile(selectProfile(req.Profile)),
		tls_client.WithCookieJar(jar),
	)
	if err != nil {
		return nil, fmt.Errorf("create tls client: %w", err)
	}

	out := &BatchResponse{
		Responses: make([]ResponseItem, len(req.Requests)),
	}

	for i, spec := range req.Requests {
		method := strings.ToUpper(strings.TrimSpace(spec.Method))
		if method == "" {
			method = fhttp.MethodGet
		}

		var bodyReader io.Reader
		if spec.Body != "" {
			bodyReader = strings.NewReader(spec.Body)
		}

		httpReq, err := fhttp.NewRequestWithContext(ctx, method, spec.URL, bodyReader)
		if err != nil {
			out.Responses[i] = ResponseItem{Error: err.Error()}
			continue
		}

		if req.UserAgent != "" {
			httpReq.Header.Set("User-Agent", req.UserAgent)
		}
		httpReq.Header.Set("Accept", "application/json, text/javascript, */*; q=0.01")
		httpReq.Header.Set("Accept-Language", "en-US,en;q=0.5")
		for k, v := range spec.Headers {
			httpReq.Header.Set(k, v)
		}
		httpReq.Header[fhttp.HeaderOrderKey] = []string{
			"host",
			"user-agent",
			"accept",
			"accept-language",
			"accept-encoding",
			"content-type",
			"x-requested-with",
			"origin",
			"referer",
			"cookie",
		}

		resp, err := client.Do(httpReq)
		if err != nil {
			out.Responses[i] = ResponseItem{Error: err.Error()}
			continue
		}
		b, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if readErr != nil {
			out.Responses[i] = ResponseItem{Status: resp.StatusCode, Error: readErr.Error()}
			continue
		}
		out.Responses[i] = ResponseItem{
			Status: resp.StatusCode,
			Body:   string(b),
		}
	}

	return out, nil
}
