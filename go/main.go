package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

const (
	dims      = 768
	window    = 50
	userBytes = 2048
	toolBytes = 65536
)

func value(i, j int) float64 {
	return float64((i*dims+j)%1024) + 0.5
}

func embeddings(n int) float64 {
	store := make([][]float32, n)
	for i := range store {
		v := make([]float32, dims)
		for j := range v {
			v[j] = float32(value(i, j))
		}
		store[i] = v
	}
	total := 0.0
	for _, v := range store {
		for _, x := range v {
			total += float64(x)
		}
	}
	return total
}

func session(turns int) uint64 {
	history := make([]string, 0, window*2+2)
	var checksum uint64
	for turn := 0; turn < turns; turn++ {
		ch := byte('a' + turn%26)
		history = append(history, strings.Repeat(string(ch), userBytes))
		history = append(history, strings.Repeat(string(ch-32), toolBytes))
		if len(history) > window*2 {
			history = append(history[:0], history[len(history)-window*2:]...)
		}
		total := 0
		for _, m := range history {
			total += len(m)
		}
		var b strings.Builder
		b.Grow(total)
		for _, m := range history {
			b.WriteString(m)
		}
		prompt := b.String()
		checksum += uint64(len(prompt)) + uint64(prompt[len(prompt)/2])
	}
	return checksum
}

func main() {
	workload := "noop"
	n := 0
	if len(os.Args) > 1 {
		workload = os.Args[1]
	}
	if len(os.Args) > 2 {
		n, _ = strconv.Atoi(os.Args[2])
	}
	switch workload {
	case "noop":
		fmt.Println("checksum=0")
	case "embeddings":
		fmt.Printf("checksum=%.0f\n", embeddings(n))
	case "session":
		fmt.Printf("checksum=%d\n", session(n))
	default:
		fmt.Fprintf(os.Stderr, "unknown workload %s\n", workload)
		os.Exit(2)
	}
}
