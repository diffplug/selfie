package com.example.unrelated;

import static com.diffplug.selfie.Selfie.expectSelfie;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.assertj.core.api.Assertions;
import org.junit.jupiter.api.Test;

public class LandingPage {
  public List<Integer> primesBelow(int max) {
    boolean[] isPrime = new boolean[max];
    Arrays.fill(isPrime, true);
    isPrime[0] = false;
    isPrime[1] = false;
    for (int i = 2; i * i < max; i++) {
      if (isPrime[i]) {
        for (int j = i * i; j < max; j += i) {
          isPrime[j] = false;
        }
      }
    }
    List<Integer> primes = new ArrayList<>();
    for (int i = 2; i < max; i++) {
      if (isPrime[i]) {
        primes.add(i);
      }
    }
    return primes;
  }

  @Test
  public void primesBelow100() {
    Assertions.assertThat(primesBelow(100)).startsWith(2, 3, 5, 7).endsWith(89, 97);
  }

  @Test
  public void blahblahblah() {
    expectSelfie(primesBelow(100).toString())
        .toBe(
            "[2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97]");
  }

  @Test
  public void getStartedBeyongToString() {
    expectSelfie(10 / 4).toBe(2);
    expectSelfie((10 / 4) == 2).toBe(true);
    expectSelfie(TimeUnit.DAYS.toMillis(365 * 1_000_000L)).toBe(31_536_000_000_000_000L);
    // expectSelfie(new byte[100]).toMatchDisk();
  }
}
