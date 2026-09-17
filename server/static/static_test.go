package static

import "testing"

func TestIsMutableWebVersion(t *testing.T) {
	tests := []struct {
		name    string
		version string
		want    bool
	}{
		{name: "empty", version: "", want: true},
		{name: "beta", version: "beta", want: true},
		{name: "dev", version: "dev", want: true},
		{name: "legacy rolling", version: "rolling", want: true},
		{name: "edge", version: "edge", want: true},
		{name: "stable", version: "v4.1.0", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isMutableWebVersion(tt.version); got != tt.want {
				t.Fatalf("isMutableWebVersion(%q) = %v, want %v", tt.version, got, tt.want)
			}
		})
	}
}
