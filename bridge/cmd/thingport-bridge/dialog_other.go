//go:build !windows && !linux && !darwin

package main

func askAboutFailure(problem) choice { return choiceClose }

var localNetworkPrivacy = false

func openLocalNetworkSettings() {}
