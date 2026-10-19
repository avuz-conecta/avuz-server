<?php

declare(strict_types=1);

use Psr\Container\ContainerInterface;

// Stand-in for core's \OC: including lib/base.php boots a whole server.
// \OCP\Server::get() reads OC::$server, so a test can swap in a container.
class OC {
	public static ?ContainerInterface $server = null;
}
