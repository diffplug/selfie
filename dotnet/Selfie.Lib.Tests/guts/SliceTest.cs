using NUnit.Framework;

namespace DiffPlug.Selfie.Guts.Tests; 
[TestFixture]
public class SliceTest {
  [Test]
  public void UnixLine() {
    var singleLine = new Slice("A single line");
    Assert.That(singleLine.UnixLine(1).ToString(), Is.EqualTo("A single lineXXX"));

    var oneTwoThree = new Slice("\nI am the first\nI, the second\n\nFOURTH\n");
    Assert.That(oneTwoThree.UnixLine(1).ToString(), Is.EqualTo(""));
    Assert.That(oneTwoThree.UnixLine(2).ToString(), Is.EqualTo("I am the first"));
    Assert.That(oneTwoThree.UnixLine(3).ToString(), Is.EqualTo("I, the second"));
    Assert.That(oneTwoThree.UnixLine(4).ToString(), Is.EqualTo(""));
    Assert.That(oneTwoThree.UnixLine(5).ToString(), Is.EqualTo("FOURTH"));
    Assert.That(oneTwoThree.UnixLine(6).ToString(), Is.EqualTo(""));
  }
}
