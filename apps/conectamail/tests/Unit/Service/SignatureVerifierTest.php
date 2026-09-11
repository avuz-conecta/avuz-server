<?php
namespace OCA\Roundcube\Tests\Unit\Service;
use OCA\Roundcube\Service\SignatureVerifier;
use OCA\Roundcube\Service\SignatureException;
use PHPUnit\Framework\TestCase;

class SignatureVerifierTest extends TestCase {
    private string $secret = 'test-secret';

    private function envelope(array $payload): string {
        $p = rtrim(strtr(base64_encode(json_encode($payload)), '+/', '-_'), '=');
        return $p . '.' . hash_hmac('sha256', $p, $this->secret);
    }

    public function testVerifyReturnsPayloadForValidEnvelope(): void {
        $ics = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
        $env = $this->envelope(['email'=>'a@b.com','iat'=>time(),'ics_sha256'=>hash('sha256',$ics)]);
        $payload = (new SignatureVerifier($this->secret))->verify($env, $ics);
        $this->assertSame('a@b.com', $payload['email']);
    }

    public function testRejectsTamperedSignature(): void {
        $this->expectException(SignatureException::class);
        $ics = 'x';
        $env = $this->envelope(['email'=>'a@b.com','iat'=>time(),'ics_sha256'=>hash('sha256',$ics)]);
        (new SignatureVerifier($this->secret))->verify($env . 'z', $ics);
    }

    public function testRejectsExpired(): void {
        $this->expectException(SignatureException::class);
        $ics = 'x';
        $env = $this->envelope(['email'=>'a@b.com','iat'=>time()-3600,'ics_sha256'=>hash('sha256',$ics)]);
        (new SignatureVerifier($this->secret))->verify($env, $ics);
    }

    public function testRejectsBodyHashMismatch(): void {
        $this->expectException(SignatureException::class);
        $env = $this->envelope(['email'=>'a@b.com','iat'=>time(),'ics_sha256'=>hash('sha256','original')]);
        (new SignatureVerifier($this->secret))->verify($env, 'tampered-body');
    }
}
