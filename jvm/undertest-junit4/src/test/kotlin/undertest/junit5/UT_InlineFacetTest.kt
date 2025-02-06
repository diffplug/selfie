package undertest.junit5

import com.diffplug.selfie.Selfie.expectSelfie
import com.diffplug.selfie.Snapshot
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class UT_InlineFacetTest {
  @Test fun singleFacet() {
    val zero = Snapshot.of("no facets")
    expectSelfie(zero).toBe("no facets")
    expectSelfie(zero).facet("").toBe("no facets")
    expectSelfie(zero).facets("").toBe("no facets")
    assertThrows<Throwable> { expectSelfie(zero).toBe("WRONG") }
    assertThrows<Throwable> { expectSelfie(zero).facet("").toBe("WRONG") }
    assertThrows<Throwable> { expectSelfie(zero).facets("").toBe("WRONG") }

    val one = Snapshot.of("subject").plusFacet("facet", "facetValue")
    expectSelfie(one).facet("").toBe("subject")
    expectSelfie(one).facets("").toBe("subject")
    expectSelfie(one).facet("facet").toBe("facetValue")
    expectSelfie(one).facets("facet").toBe("facetValue")

    assertThrows<Throwable> { expectSelfie(one).facet("").toBe("WRONG") }
    assertThrows<Throwable> { expectSelfie(one).facets("").toBe("WRONG") }
    assertThrows<Throwable> { expectSelfie(one).facet("facet").toBe("WRONG") }
    assertThrows<Throwable> { expectSelfie(one).facets("facet").toBe("WRONG") }
  }

  @Test fun multipleFacets() {
    val multiple =
        Snapshot.of("subject")
            .plusFacet("facet1", "facetValue1")
            .plusFacet("facet2", "facetValue2")
            .plusFacet("facet3", "facetValue3")
    expectSelfie(multiple)
        .toBe(
            """
            subject
            ╔═ [facet1] ═╗
            facetValue1
            ╔═ [facet2] ═╗
            facetValue2
            ╔═ [facet3] ═╗
            facetValue3
        """
                .trimIndent())
    assertThrows<Throwable> { expectSelfie(multiple).toBe("WRONG") }
    expectSelfie(multiple)
        .facets("", "facet1")
        .toBe(
            """
            subject
            ╔═ [facet1] ═╗
            facetValue1
        """
                .trimIndent())
    assertThrows<Throwable> { expectSelfie(multiple).facets("", "facet1").toBe("WRONG") }
    expectSelfie(multiple)
        .facets("facet3", "facet2")
        .toBe(
            """
            ╔═ [facet3] ═╗
            facetValue3
            ╔═ [facet2] ═╗
            facetValue2
        """
                .trimIndent())
    assertThrows<Throwable> { expectSelfie(multiple).facets("facet3", "facet2").toBe("WRONG") }
    expectSelfie(
            assertThrows<Throwable> {
                  expectSelfie(multiple)
                      .facets("facet1", "")
                      .toBe(
                          """
                    subject
                    ╔═ [facet1] ═╗
                    facetValue1
                """
                              .trimIndent())
                }
                .message!!)
        .toBe(
            "If you're going to specify the subject facet (\"\"), you have to list it first, this was [facet1, ]")
  }
}
