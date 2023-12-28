package com.example;

import jakarta.mail.internet.InternetAddress;

/** Sends an email in another thread to avoid blocking. */
public abstract class Email {
  public String subject;
  public String htmlMsg;
  public InternetAddress from;
  public InternetAddress to;

  public abstract void doSend();

  static class Production extends Email {
    @Override
    public void doSend() {
      throw new UnsupportedOperationException("TODO: connect to SMTP server or something");
    }
  }
}
