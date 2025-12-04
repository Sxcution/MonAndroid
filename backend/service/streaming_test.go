package service

import (
	"bufio"
	"bytes"
	"encoding/hex"
	"testing"
)

func TestReadNextAnnexBFrame_Reproduction(t *testing.T) {
	// Construct a stream with SPS, PPS, and IDR
	// SPS: 00 00 00 01 67 ...
	// PPS: 00 00 00 01 68 ...
	// IDR: 00 00 00 01 65 ...

	sps := []byte{0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0x00, 0x0a, 0xf8, 0x41, 0xa2}
	pps := []byte{0x00, 0x00, 0x00, 0x01, 0x68, 0xce, 0x38, 0x80}
	idr := []byte{0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x00, 0x10} // IDR slice

	// Combine them
	var streamData []byte
	streamData = append(streamData, sps...)
	streamData = append(streamData, pps...)
	streamData = append(streamData, idr...)

	reader := bytes.NewReader(streamData)
	br := bufio.NewReader(reader)

	// First call should return SPS + PPS
	// Because it reads SPS, then PPS, then sees IDR (5) and stops to return what it has.
	frame1, err := readNextAnnexBFrame(br)
	if err != nil {
		t.Fatalf("First read failed: %v", err)
	}

	expectedFrame1Len := len(sps) + len(pps)
	if len(frame1) != expectedFrame1Len {
		t.Errorf("Expected frame 1 length %d, got %d", expectedFrame1Len, len(frame1))
	}

	// Verify content of frame 1
	if !bytes.Equal(frame1[:len(sps)], sps) {
		t.Errorf("Frame 1 does not start with SPS")
	}
	if !bytes.Equal(frame1[len(sps):], pps) {
		t.Errorf("Frame 1 does not contain PPS after SPS")
	}

	// Second call should return IDR
	// This is where it will fail with the current bug because the IDR start code was "unread" incorrectly
	frame2, err := readNextAnnexBFrame(br)
	if err != nil {
		t.Fatalf("Second read failed: %v", err)
	}

	if !bytes.Equal(frame2, idr) {
		t.Errorf("Frame 2 mismatch.\nExpected: %s\nGot:      %s", hex.EncodeToString(idr), hex.EncodeToString(frame2))
	}
}
